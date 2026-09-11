import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_CONNECTORS,
  mergeConnectors,
} from "../lib/repositories/workspace/mcp-registry";

// The connector allowlist the MCP server enforces before it consults the
// gateway. It used to be DEFAULT_MCP_CONNECTORS and nothing else — eight
// runtime names — so a governed `github` or `stripe` tool call was refused on
// every deployment, with no tenant-side setting that could change it.

describe("governed MCP connector vocabulary", () => {
  it("keeps the runtime defaults, which existing callers rely on", () => {
    expect(mergeConnectors([])).toEqual([...DEFAULT_MCP_CONNECTORS].sort());
  });

  it("admits the connectors a tenant actually governs", () => {
    const merged = mergeConnectors(["github", "stripe"]);
    expect(merged).toContain("github");
    expect(merged).toContain("stripe");
    for (const preset of DEFAULT_MCP_CONNECTORS) expect(merged).toContain(preset);
  });

  it("does not duplicate a connector that is also a default", () => {
    const merged = mergeConnectors(["mcp", "mcp", "github"]);
    expect(merged.filter((connector) => connector === "mcp")).toHaveLength(1);
  });

  it("ignores blank and whitespace-only rows rather than allowlisting an empty connector", () => {
    // envAllowlistDenies treats a missing connector as denied, but a "" entry in
    // the policy allowlist would silently allow one.
    expect(mergeConnectors(["", "   "])).toEqual([...DEFAULT_MCP_CONNECTORS].sort());
  });

  it("trims, so a stray space in a pack's connector does not create a second one", () => {
    expect(mergeConnectors([" github "])).toContain("github");
  });
});
