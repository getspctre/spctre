import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

vi.mock("../src/observability.js", () => ({
  incrementCounter: vi.fn(),
  recordDuration: vi.fn(),
  setGauge: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withSpan: vi.fn(async (_name: string, _attrs: unknown, fn: () => Promise<void>) => fn()),
}));

import axios from "axios";
import {
  AccessTokenManager,
  TokenLifecycleError,
  REFRESH_MAX_ATTEMPTS,
  REFRESH_BACKOFF_BASE_MS,
  AXIOS_TIMEOUT_MS,
} from "../src/token.js";

const axiosPost = vi.mocked(axios.post);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AccessTokenManager — constants", () => {
  it("retries at most 3 times with bounded backoff", () => {
    expect(REFRESH_MAX_ATTEMPTS).toBe(3);
    expect(REFRESH_BACKOFF_BASE_MS).toBeGreaterThanOrEqual(500);
  });

  it("per-request timeout is well above p99 SLO", () => {
    expect(AXIOS_TIMEOUT_MS).toBeGreaterThan(250);
  });
});

describe("AccessTokenManager — getValidAccessToken", () => {
  it("returns cached token when not expiring soon", async () => {
    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      accessToken: "valid-token",
    });

    const token = await mgr.getValidAccessToken();
    expect(token).toBe("valid-token");
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("throws no_refresh_token when token is absent and no refresh token configured", async () => {
    const mgr = new AccessTokenManager({ apiBaseUrl: "http://localhost" });

    await expect(mgr.getValidAccessToken()).rejects.toSatisfy(
      (e: unknown) => e instanceof TokenLifecycleError && e.kind === "no_refresh_token",
    );
  });
});

describe("AccessTokenManager — refresh", () => {
  it("updates access token on successful refresh", async () => {
    axiosPost.mockResolvedValueOnce({
      data: {
        accessToken: "new-access-token",
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
    });

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-valid",
    });

    await mgr.refresh();
    const token = await mgr.getValidAccessToken();
    expect(token).toBe("new-access-token");
  });

  it("throws token_revoked immediately on 401 with 'revoked' body", async () => {
    const err = Object.assign(new Error("Unauthorized"), {
      response: { status: 401, data: { error: "Token has been revoked" } },
    });
    axiosPost.mockRejectedValue(err);

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-revoked",
    });

    await expect(mgr.refresh()).rejects.toSatisfy(
      (e: unknown) => e instanceof TokenLifecycleError && e.kind === "token_revoked",
    );
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });

  it("throws token_expired immediately on 401 without 'revoked' in body", async () => {
    const err = Object.assign(new Error("Unauthorized"), {
      response: { status: 401, data: { error: "Token expired" } },
    });
    axiosPost.mockRejectedValue(err);

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-expired",
    });

    await expect(mgr.refresh()).rejects.toSatisfy(
      (e: unknown) => e instanceof TokenLifecycleError && e.kind === "token_expired",
    );
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });

  it("retries network errors up to REFRESH_MAX_ATTEMPTS times then throws refresh_network_error", async () => {
    const networkErr = new Error("Network error");
    axiosPost.mockRejectedValue(networkErr);

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-network-fail",
    });

    // Attach the rejection handler before running timers so Node never sees
    // the promise as unhandled between attempts.
    const assertion = expect(mgr.refresh()).rejects.toSatisfy(
      (e: unknown) => e instanceof TokenLifecycleError && e.kind === "refresh_network_error",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(axiosPost).toHaveBeenCalledTimes(REFRESH_MAX_ATTEMPTS);
  });

  it("coalesces concurrent refreshes into a single in-flight request (single-flight)", async () => {
    // Refresh tokens rotate on use, so N concurrent refreshes must not fire N
    // requests — the racers would submit an already-invalidated token and the
    // server could kill the session. See concurrency-and-memory-audit finding 1.
    let resolvePost: (v: unknown) => void = () => {};
    axiosPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-concurrent",
    });

    const a = mgr.refresh();
    const b = mgr.refresh();
    const c = mgr.refresh();

    resolvePost({ data: { accessToken: "shared-token", refreshToken: "rt-rotated" } });
    await Promise.all([a, b, c]);

    // Exactly one HTTP refresh despite three concurrent callers.
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(await mgr.getValidAccessToken()).toBe("shared-token");

    // After settling, a later refresh starts a fresh request.
    axiosPost.mockResolvedValueOnce({ data: { accessToken: "later-token" } });
    await mgr.refresh();
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it("succeeds on second attempt after one network failure", async () => {
    axiosPost
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ data: { accessToken: "recovered-token" } });

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-retry-ok",
    });

    const refreshPromise = mgr.refresh();
    await vi.runAllTimersAsync();
    await refreshPromise;

    const token = await mgr.getValidAccessToken();
    expect(token).toBe("recovered-token");
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });
});

describe("AccessTokenManager — revokeBestEffort", () => {
  it("does not revoke a static access token", async () => {
    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      accessToken: "static-token",
    });

    await expect(mgr.revokeBestEffort()).resolves.toBeUndefined();
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("does not call API when no access token is set", async () => {
    const mgr = new AccessTokenManager({ apiBaseUrl: "http://localhost" });

    await mgr.revokeBestEffort();
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("does not throw when revoke request for refreshed token fails", async () => {
    axiosPost
      .mockResolvedValueOnce({ data: { accessToken: "refreshed-token" } })
      .mockRejectedValueOnce(new Error("revoke failed"));

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-valid",
    });

    await mgr.refresh();
    await expect(mgr.revokeBestEffort()).resolves.toBeUndefined();
  });

  it("calls revoke endpoint with Bearer token for a refreshed access token", async () => {
    axiosPost
      .mockResolvedValueOnce({ data: { accessToken: "refreshed-token" } })
      .mockResolvedValueOnce({});

    const mgr = new AccessTokenManager({
      apiBaseUrl: "http://localhost",
      refreshToken: "rt-valid",
    });

    await mgr.refresh();
    await mgr.revokeBestEffort();
    expect(axiosPost).toHaveBeenCalledWith(
      "http://localhost/api/token/revoke",
      undefined,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer refreshed-token" }),
      }),
    );
  });
});
