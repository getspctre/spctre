/**
 * fetchWithRetry — bounded jittered-backoff retries plus a per-host circuit
 * breaker for idempotent/idempotency-keyed outbound calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CircuitOpenError,
  fetchWithRetry,
  resetFetchBreakers,
} from "../lib/platform/fetch-retry";

const fetchMock = vi.fn();

beforeEach(() => {
  resetFetchBreakers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fast = { baseDelayMs: 1 };

describe("fetchWithRetry", () => {
  it("returns immediately on success", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("https://worker.internal/api/evidence", fast);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 and returns the eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("https://worker.internal/api/evidence", fast);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient client errors", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));

    const res = await fetchWithRetry("https://worker.internal/api/evidence", fast);
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and can recover", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("https://worker.internal/api/evidence", fast);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the last retryable response after exhausting attempts", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 502 }));

    const res = await fetchWithRetry("https://worker.internal/api/evidence", { ...fast, attempts: 3 });
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last network error after exhausting attempts", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      fetchWithRetry("https://worker.internal/api/evidence", { ...fast, attempts: 2 })
    ).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("opens the per-host breaker after consecutive failed deliveries and fails fast", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    // Three delivery failures (each with internal retries) open the breaker.
    for (let i = 0; i < 3; i++) {
      await expect(
        fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 })
      ).rejects.toThrow("fetch failed");
    }

    fetchMock.mockClear();
    await expect(
      fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 })
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchMock).not.toHaveBeenCalled();

    // Other hosts are unaffected.
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry("https://healthy.example.test/hook", fast);
    expect(res.status).toBe(200);
  });

  it("does not blackhole a host when the half-open probe is aborted by the caller", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Open the breaker with three failed deliveries.
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      for (let i = 0; i < 3; i++) {
        await expect(
          fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 })
        ).rejects.toThrow("fetch failed");
      }

      // Cooldown elapses; the next call is admitted as the half-open probe,
      // but the caller aborts it mid-flight.
      vi.setSystemTime(Date.now() + 61_000);
      const controller = new AbortController();
      fetchMock.mockImplementationOnce(() => {
        controller.abort(new Error("caller aborted"));
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      });
      await expect(
        fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1, signal: controller.signal })
      ).rejects.toThrow();

      // The abandoned probe must not leave the breaker half-open forever: the
      // next call is admitted as a fresh probe and a success closes the breaker.
      fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
      const res = await fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 });
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an aborted non-probe call does not release another caller's half-open probe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Call A is admitted while the breaker is closed and stays in flight.
      const controllerA = new AbortController();
      let rejectA!: (err: unknown) => void;
      fetchMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectA = reject; }));
      const callA = fetchWithRetry("https://down.example.test/hook", {
        ...fast,
        attempts: 1,
        signal: controllerA.signal,
      });
      const callARejects = expect(callA).rejects.toThrow();

      // Three failed deliveries open the breaker while A is still in flight.
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      for (let i = 0; i < 3; i++) {
        await expect(
          fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 })
        ).rejects.toThrow("fetch failed");
      }

      // Cooldown elapses; call B is admitted as the half-open probe and stays
      // in flight.
      vi.setSystemTime(Date.now() + 61_000);
      let resolveB!: (res: Response) => void;
      fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
      const callB = fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 });

      // A's caller aborts. A was not the probe, so B's probe must stay held:
      // the breaker keeps rejecting new calls instead of admitting a second
      // concurrent probe.
      controllerA.abort(new Error("caller aborted"));
      rejectA(new DOMException("The operation was aborted.", "AbortError"));
      await callARejects;
      await expect(
        fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 })
      ).rejects.toBeInstanceOf(CircuitOpenError);

      // B's probe succeeds and closes the breaker.
      resolveB(new Response("ok", { status: 200 }));
      expect((await callB).status).toBe(200);
      fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
      const res = await fetchWithRetry("https://down.example.test/hook", { ...fast, attempts: 1 });
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller aborts without retrying", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort(new Error("caller aborted"));
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });

    await expect(
      fetchWithRetry("https://worker.internal/api/evidence", { ...fast, signal: controller.signal })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
