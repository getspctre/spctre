import { describe, expect, it } from "vitest";
import { isApprovalsQueueUri, resourceTypeForUri, SpctreMcpServer } from "../src/server.js";
import { TOOL_SCHEMAS } from "../src/tools/schemas.js";
import type { SpctreConfig } from "../src/config.js";

const baseConfig: SpctreConfig = {
  apiBaseUrl: "http://localhost:3000",
  apiToken: "test-token",
  workspaceId: "ws-test",
  agentId: "agent-test",
  transport: "stdio",
  httpPort: 8090,
  httpPath: "/mcp",
  requireBearerAuth: false,
  httpRateLimitPerSecond: 25,
  httpRateLimitBurst: 50,
};

describe("SpctreMcpServer tool catalog", () => {
  it("constructs without a catalog/handler mismatch", () => {
    // The constructor runs assertToolCatalogConsistent(); a schema without a
    // handler (or vice versa) throws here.
    expect(() => new SpctreMcpServer(baseConfig)).not.toThrow();
  });

  it("advertises every declared tool schema with a unique name", () => {
    const names = TOOL_SCHEMAS.map((tool) => tool.name);
    expect(names.length).toBe(new Set(names).size);
    expect(names).toContain("evaluate_policy");
    expect(names).toContain("authorize_mcp_tool_call");
  });
});

describe("resource telemetry types", () => {
  it("uses a bounded route label instead of resource identifiers", () => {
    expect(resourceTypeForUri("spctre://evidence/decision-9b1deb4d-3b7d-4bad")).toBe("evidence");
    expect(resourceTypeForUri("spctre://approvals/approval-7f4a9c30")).toBe("approvals");
    expect(resourceTypeForUri("spctre://agents/scout/audit")).toBe("agents");
    expect(resourceTypeForUri("spctre://unknown/unique-value")).toBe("unknown");
  });
});

describe("resource route matching", () => {
  it("recognizes the approvals queue before the generic approval-ID route", () => {
    expect(isApprovalsQueueUri("spctre://approvals/queue")).toBe(true);
    expect(isApprovalsQueueUri("spctre://approvals/approval-7f4a9c30")).toBe(false);
  });
});
