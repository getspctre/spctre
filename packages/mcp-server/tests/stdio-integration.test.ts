import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

const packageRoot = new URL("../", import.meta.url).pathname;

function childEnvironment(): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    OTEL_SDK_DISABLED: "true",
    SPCTRE_API_URL: "http://127.0.0.1:3000",
    SPCTRE_API_TOKEN: "test-token",
    SPCTRE_WORKSPACE_ID: "ws-test",
    SPCTRE_AGENT_ID: "agent-test",
    SPCTRE_MCP_TRANSPORT: "stdio",
  };
}

describe("modern stdio integration", () => {
  it("negotiates MCP 2026-07-28 against the actual server process", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: packageRoot,
      env: childEnvironment(),
      stderr: "pipe",
    });
    const client = new Client({ name: "spctre-stdio-integration", version: "0.1.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("evaluate_policy");
    } finally {
      await client.close();
    }
  }, 15_000);
});
