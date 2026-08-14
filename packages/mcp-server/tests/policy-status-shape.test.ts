import type { AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import type { SpctreConfig } from "../src/config.js";
import type { McpServerContext } from "../src/handlers/context.js";
import { getPolicyStatus } from "../src/handlers/tools.js";

// get_policy_status promises callers an array of connectors and a numeric
// count. /api/adapters answers `{ adapters, meta }`, so the response body is not
// that array.
//
// This went unnoticed because the call used to fail: the control plane refused
// it at the proxy, Promise.allSettled rejected, and the fallback produced an
// empty array — the right shape for the wrong reason. Fixing the transport is
// what surfaced it, so the fallback is asserted here too, to keep an empty
// array from standing in for a real answer again.

const config: SpctreConfig = {
  apiBaseUrl: "http://control-plane.test",
  apiToken: "test-token",
  workspaceId: "ws-test",
  agentId: "agent-test",
  transport: "stdio",
  httpPort: 8090,
  httpPath: "/mcp",
  requireBearerAuth: true,
  httpRateLimitPerSecond: 25,
  httpRateLimitBurst: 50,
};

function response(data: unknown, headers: Record<string, string> = {}): AxiosResponse {
  return { data, headers, status: 200, statusText: "OK", config: {} } as unknown as AxiosResponse;
}

const BUNDLE_HEADERS = {
  "x-spctre-revision-id": "rev-1",
  "x-spctre-artifact-hash": "hash-1",
  "x-spctre-published-at": "2026-08-14T00:00:00.000Z",
};

function context(adapters: unknown, options: { failAdapters?: boolean } = {}): McpServerContext {
  return {
    config,
    getWithAuth: async (path: string) => {
      if (path === "/api/adapters") {
        if (options.failAdapters) throw new Error("Request failed with status code 403");
        return response(adapters);
      }
      return response({}, BUNDLE_HEADERS);
    },
    postWithAuth: async () => response({}),
    assertConnectorAllowed: () => {},
    fetchPublishedBundleRefs: async () => ({ branchId: "b", revisionId: "r", artifactHash: "h" }),
    ensureMcpPolicyLoaded: async () => {},
    governedMcpCapabilities: [],
    mcpRegistrySource: "api",
  };
}

async function statusFor(
  adapters: unknown,
  options: { failAdapters?: boolean } = {},
): Promise<Record<string, unknown>> {
  const result = await getPolicyStatus(context(adapters, options), { workspace_id: "ws-test" });
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("get_policy_status connector shape", () => {
  it("unwraps the adapters array from the API's envelope", async () => {
    const status = await statusFor({
      adapters: [{ connector: "notion" }, { connector: "slack" }],
      meta: { traceId: "t1" },
    });

    expect(status.connectors).toEqual([{ connector: "notion" }, { connector: "slack" }]);
    expect(status.policies_count).toBe(2);
  });

  it("never answers with the envelope itself", async () => {
    // The defect: `connectors` was `{ adapters, meta }`, and `policies_count`
    // was `undefined` because an object has no length.
    const status = await statusFor({ adapters: [], meta: { traceId: "t1" } });

    expect(Array.isArray(status.connectors)).toBe(true);
    expect(status.connectors).not.toHaveProperty("meta");
    expect(typeof status.policies_count).toBe("number");
  });

  it("accepts a bare array, should the endpoint ever return one", async () => {
    const status = await statusFor([{ connector: "notion" }]);

    expect(status.connectors).toEqual([{ connector: "notion" }]);
    expect(status.policies_count).toBe(1);
  });

  it("still reports an empty array when the call fails", async () => {
    // The shape callers depend on must hold even when the control plane
    // refuses the request, which is how this defect stayed hidden.
    const status = await statusFor(undefined, { failAdapters: true });

    expect(status.connectors).toEqual([]);
    expect(status.policies_count).toBe(0);
    // The bundle read is independent, so the published revision still reports.
    expect(status.version).toBe("rev-1");
  });

  it("tolerates an unexpected body without breaking the contract", async () => {
    for (const body of [null, "not-json", { adapters: "not-an-array" }, 42]) {
      const status = await statusFor(body);

      expect(Array.isArray(status.connectors), JSON.stringify(body)).toBe(true);
      expect(typeof status.policies_count, JSON.stringify(body)).toBe("number");
    }
  });
});
