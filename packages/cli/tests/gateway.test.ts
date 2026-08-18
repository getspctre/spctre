import { describe, expect, it, vi, afterEach } from "vitest";
import type { SpctreCliConfig } from "../src/config";
import {
  resolveGatewayConfig,
  requestGatewayDecision,
  pollEscalationResolution,
} from "../src/gateway";

const mockConfig: SpctreCliConfig = {
  controlPlaneUrl: "https://control.test",
  tenantId: "tenant-123",
  workspaceId: "ws-123",
  workspaceSlug: "ws-slug",
  agentId: "agent-1",
  environment: "production",
  token: "test-token",
  tokenId: "tok-1",
  tokenExpiresAt: "expires",
  artifactHash: "hash-123",
  branchId: "branch-1",
  revisionId: "rev-1",
  bundlePath: "bundle.json",
  policyContext: [],
};

describe("CLI Gateway Integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SPCTRE_GATEWAY_URL;
    delete process.env.SPCTRE_GATEWAY_TIMEOUT;
    delete process.env.SPCTRE_GATEWAY_POLL_INTERVAL;
    delete process.env.SPCTRE_GATEWAY_OUTAGE_POLICY;
  });

  describe("resolveGatewayConfig", () => {
    it("returns null when no gateway URL is configured", () => {
      const cfg = resolveGatewayConfig(mockConfig, "observe");
      expect(cfg).toBeNull();
    });

    it("resolves config from config.gatewayUrl", () => {
      const cfg = resolveGatewayConfig(
        { ...mockConfig, gatewayUrl: "https://gw.test/" },
        "observe",
      );
      expect(cfg).toEqual({
        gatewayUrl: "https://gw.test",
        token: "test-token",
        timeoutMs: 1800000,
        pollIntervalMs: 10000,
        outagePolicy: "fail-open",
      });
    });

    it("resolves config and overrides from environment variables", () => {
      process.env.SPCTRE_GATEWAY_URL = "https://env-gw.test/";
      process.env.SPCTRE_GATEWAY_TIMEOUT = "60";
      process.env.SPCTRE_GATEWAY_POLL_INTERVAL = "5";

      const cfg = resolveGatewayConfig(mockConfig, "observe");
      expect(cfg).toEqual({
        gatewayUrl: "https://env-gw.test",
        token: "test-token",
        timeoutMs: 60000,
        pollIntervalMs: 5000,
        outagePolicy: "fail-open",
      });
    });

    it("defaults to fail-closed in enforce mode", () => {
      const cfg = resolveGatewayConfig({ ...mockConfig, gatewayUrl: "https://gw.test" }, "enforce");
      expect(cfg?.outagePolicy).toBe("fail-closed");
    });

    it("honors config outagePolicy fallback", () => {
      const cfg = resolveGatewayConfig(
        { ...mockConfig, gatewayUrl: "https://gw.test", gatewayOutagePolicy: "fail-closed" },
        "observe",
      );
      expect(cfg?.outagePolicy).toBe("fail-closed");
    });

    it("honors environment override for outagePolicy", () => {
      process.env.SPCTRE_GATEWAY_OUTAGE_POLICY = "fail-open";
      const cfg = resolveGatewayConfig(
        { ...mockConfig, gatewayUrl: "https://gw.test", gatewayOutagePolicy: "fail-closed" },
        "enforce",
      );
      expect(cfg?.outagePolicy).toBe("fail-open");
    });
  });

  describe("requestGatewayDecision", () => {
    it("makes correct fetch post call and parses decision response", async () => {
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 10000,
        pollIntervalMs: 2000,
      };

      const mockResponse = {
        gatewayEnabled: true,
        mode: "HYBRID",
        persisted: true,
        queued: true,
        decision: {
          outcome: "ESCALATE",
          reason: "Needs approval",
          riskLevel: "HIGH",
          shouldQueue: true,
          slaHours: 2,
        },
      };

      const fetchSpy = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => mockResponse } as Response);
      vi.stubGlobal("fetch", fetchSpy);

      const decision = await requestGatewayDecision(gwConfig, mockConfig, {
        decisionId: "dec-1",
        connector: "slack",
        action: "post",
        toolIntent: "post alert",
      });

      expect(fetchSpy).toHaveBeenCalledWith("https://gw.test/api/gateway/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token-123" },
        body: JSON.stringify({
          decisionId: "dec-1",
          artifactHash: "hash-123",
          policyContext: [],
          agentId: "agent-1",
          connector: "slack",
          action: "post",
          toolIntent: "post alert",
        }),
        signal: expect.any(AbortSignal),
      });

      expect(decision).toEqual(mockResponse);
    });

    it("returns null on fetch failure", async () => {
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 10000,
        pollIntervalMs: 2000,
      };

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network Error")));

      const decision = await requestGatewayDecision(gwConfig, mockConfig, { decisionId: "dec-1" });
      expect(decision).toBeNull();
    });
  });

  describe("pollEscalationResolution", () => {
    it("polls until status is RESOLVED", async () => {
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 5000,
        pollIntervalMs: 5,
      };

      let callCount = 0;
      const fetchSpy = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ decisionId: "dec-1", status: "PENDING" }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            decisionId: "dec-1",
            status: "RESOLVED",
            resolutionOutcome: "PROCEED",
            agentGuidance: "Go ahead",
          }),
        } as Response;
      });

      vi.stubGlobal("fetch", fetchSpy);
      const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const resolution = await pollEscalationResolution(gwConfig, "dec-1");

      expect(resolution).toEqual({
        decisionId: "dec-1",
        status: "RESOLVED",
        resolutionOutcome: "PROCEED",
        agentGuidance: "Go ahead",
      });
      expect(callCount).toBe(2);
      expect(stderrWriteSpy).toHaveBeenCalledWith(".");
    });

    it("returns synthetic EXPIRED status on timeout", async () => {
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 10,
        pollIntervalMs: 5,
      };

      const fetchSpy = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ decisionId: "dec-1", status: "PENDING" }),
        } as Response);
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const resolution = await pollEscalationResolution(gwConfig, "dec-1");
      expect(resolution.status).toBe("EXPIRED");
    });

    // Mirrors real fetch: a request that never responds stays pending until its
    // signal aborts, then rejects. A mock that ignores the signal would hide a
    // regression in how the attempt deadline is applied.
    function stallingFetch() {
      return vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "TimeoutError")),
            );
          }),
      );
    }

    it("does not outlive its deadline when a status request stalls", async () => {
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 10,
        pollIntervalMs: 60_000,
      };
      const fetchSpy = stallingFetch();
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const resolutionPromise = pollEscalationResolution(gwConfig, "dec-1");

      await expect(resolutionPromise).resolves.toEqual({ decisionId: "dec-1", status: "EXPIRED" });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("keeps retrying on its poll cadence while requests stall", async () => {
      // A stalled attempt must cost one poll interval, not the whole budget —
      // otherwise the first dead connection burns the entire escalation window
      // and a reviewer's approval is never seen.
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 200,
        pollIntervalMs: 20,
      };
      const fetchSpy = stallingFetch();
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const resolution = await pollEscalationResolution(gwConfig, "dec-1");

      expect(resolution.status).toBe("EXPIRED");
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    });

    it("sees a resolution that arrives after an earlier request stalled", async () => {
      const gwConfig = {
        gatewayUrl: "https://gw.test",
        token: "token-123",
        timeoutMs: 500,
        pollIntervalMs: 20,
      };
      let attempt = 0;
      const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        attempt += 1;
        // First attempt stalls until aborted; the reviewer resolves afterwards.
        if (attempt === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "TimeoutError")),
            );
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ decisionId: "dec-1", status: "RESOLVED" }),
        } as Response);
      });
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const resolution = await pollEscalationResolution(gwConfig, "dec-1");

      expect(resolution.status).toBe("RESOLVED");
    });
  });
});
