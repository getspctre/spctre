import type { AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import type { SpctreConfig } from "../src/config.js";
import type { McpServerContext } from "../src/handlers/context.js";
import { getPolicyStatus } from "../src/handlers/tools.js";

// get_policy_status describes the published policy, so policies_count and
// connectors are read from the bundle.
//
// They used to come from /api/adapters, which lists adapter declarations — a
// different subject that also happens to be a list, so the count looked
// plausible while measuring the wrong thing. It was additionally the whole
// response envelope rather than its array, which only showed once the endpoint
// became reachable: before that the call was refused, the fallback produced an
// empty array, and the shape looked right for the wrong reason.

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

interface Options {
  bundle?: unknown;
  adapters?: unknown;
  failAdapters?: boolean;
  failBundle?: boolean;
}

function context(options: Options): McpServerContext {
  return {
    config,
    getWithAuth: async (path: string) => {
      if (path === "/api/adapters") {
        if (options.failAdapters) throw new Error("Request failed with status code 403");
        return response(options.adapters ?? { adapters: [], meta: {} });
      }
      if (options.failBundle) throw new Error("Request failed with status code 404");
      return response(options.bundle ?? {}, BUNDLE_HEADERS);
    },
    postWithAuth: async () => response({}),
    assertConnectorAllowed: () => {},
    fetchPublishedBundleRefs: async () => ({ branchId: "b", revisionId: "r", artifactHash: "h" }),
    ensureMcpPolicyLoaded: async () => {},
    governedMcpCapabilities: [],
    mcpRegistrySource: "api",
  };
}

async function statusFor(options: Options): Promise<Record<string, unknown>> {
  const result = await getPolicyStatus(context(options), { workspace_id: "ws-test" });
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const BUNDLE = {
  rules: [
    { id: "r1", connectors: ["notion", "mcp"] },
    { id: "r2", connectors: ["mcp"] },
    { id: "r3", connectors: [] },
  ],
};

describe("get_policy_status", () => {
  it("counts the published policy's rules, not adapter declarations", async () => {
    const status = await statusFor({
      bundle: BUNDLE,
      // Deliberately a different length, so a count taken from the wrong
      // source cannot coincide with the right answer.
      adapters: { adapters: [{ connector: "slack" }], meta: {} },
    });

    expect(status.policies_count).toBe(3);
  });

  it("lists the connectors the published rules govern", async () => {
    const status = await statusFor({ bundle: BUNDLE });

    // Distinct and ordered, so the value is stable between calls.
    expect(status.connectors).toEqual(["mcp", "notion"]);
  });

  it("keeps a wildcard rule visible rather than dropping it", async () => {
    // "*" means every connector. Removing it would report a narrower policy
    // than the one actually published.
    const status = await statusFor({ bundle: { rules: [{ id: "r1", connectors: ["*"] }] } });

    expect(status.connectors).toEqual(["*"]);
  });

  it("reports adapter declarations under their own name", async () => {
    const status = await statusFor({
      bundle: BUNDLE,
      adapters: { adapters: [{ connector: "slack" }], meta: { traceId: "t1" } },
    });

    expect(status.adapters).toEqual([{ connector: "slack" }]);
    // The envelope is never passed through: it is not the list.
    expect(status.adapters).not.toHaveProperty("meta");
  });

  it("accepts a bare adapters array, should the endpoint ever return one", async () => {
    const status = await statusFor({ bundle: BUNDLE, adapters: [{ connector: "slack" }] });

    expect(status.adapters).toEqual([{ connector: "slack" }]);
  });

  it("still answers with the promised types when a call fails", async () => {
    // Where the defect hid: an empty array standing in for a real answer.
    const status = await statusFor({ bundle: BUNDLE, failAdapters: true });

    expect(status.adapters).toEqual([]);
    expect(status.policies_count).toBe(3);
    expect(status.connectors).toEqual(["mcp", "notion"]);
  });

  it("reports an unpublished workspace as empty, not broken", async () => {
    const status = await statusFor({ failBundle: true });

    expect(status.policies_count).toBe(0);
    expect(status.connectors).toEqual([]);
    expect(status.approval_status).toBe("UNAVAILABLE");
  });

  it("tolerates unexpected bodies without breaking the contract", async () => {
    for (const bundle of [null, "not-json", { rules: "not-an-array" }, 42]) {
      const status = await statusFor({ bundle, adapters: bundle });

      expect(Array.isArray(status.connectors), JSON.stringify(bundle)).toBe(true);
      expect(Array.isArray(status.adapters), JSON.stringify(bundle)).toBe(true);
      expect(typeof status.policies_count, JSON.stringify(bundle)).toBe("number");
    }
  });
});
