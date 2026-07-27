import { describe, expect, it } from "vitest";
import { SpctreMcpServer } from "../src/server.js";
import { TOOL_SCHEMAS } from "../src/tools/schemas.js";
import type { SpctreConfig } from "../src/config.js";

const baseConfig: SpctreConfig = {
  apiBaseUrl: "http://localhost:3000",
  apiToken: "test-token",
  workspaceId: "ws-test",
  agentId: "agent-test",
  transport: "stdio",
  httpPort: 8090,
  ssePath: "/sse",
  messagePath: "/message",
  requireBearerAuth: false,
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
