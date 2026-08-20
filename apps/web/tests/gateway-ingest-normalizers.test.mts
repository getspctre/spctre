import { describe, expect, it, vi } from "vitest";

const { warnSpy, incrementCounterSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  incrementCounterSpy: vi.fn(),
}));

vi.mock("@spctre/platform/logging", () => ({ logger: { warn: warnSpy } }));
vi.mock("@spctre/platform/metrics", () => ({
  incrementCounter: incrementCounterSpy,
  recordDuration: vi.fn(),
}));
vi.mock("@/lib/repositories/operations-log", () => ({ appendOperationsLog: vi.fn() }));
vi.mock("@/lib/repositories/gateway", () => ({ resolveRevisionAtTime: vi.fn() }));
vi.mock("@/lib/repositories/evidence", () => ({ insertGatewayEvidenceEvent: vi.fn() }));

const { normalizeHeliconeEvent, normalizeLitellmEvent } =
  await import("../lib/domains/gateway/ingest");

describe("gateway event numeric normalization", () => {
  it("clamps negative LiteLLM latency instead of dropping the event", () => {
    const event = normalizeLitellmEvent({ id: "litellm-1", startTime: 20, endTime: 10 });

    expect(event?.latencyMs).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "Gateway event numeric field normalized",
      expect.objectContaining({ provider: "litellm", field: "latencyMs" }),
    );
    expect(incrementCounterSpy).toHaveBeenCalledWith("spctre.gateway.event.normalized", 1, {
      provider: "litellm",
      field: "latencyMs",
    });
  });

  it("rounds non-integer provider token counts to the public contract", () => {
    const event = normalizeHeliconeEvent({
      data: {
        id: "helicone-1",
        response: { usage: { prompt_tokens: 1.7, completion_tokens: 2.2 } },
      },
    });

    expect(event).toMatchObject({ promptTokens: 2, completionTokens: 2 });
    expect(warnSpy).toHaveBeenCalledWith(
      "Gateway event numeric field normalized",
      expect.objectContaining({ provider: "helicone", field: "promptTokens" }),
    );
  });
});
