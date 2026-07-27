import { describe, expect, it } from "vitest";
import { listPromptTemplates, renderPromptTemplate } from "../src/prompts.js";

describe("MCP prompt templates", () => {
  it("advertises governance, evidence, gateway, escalation, and hardening templates", () => {
    const prompts = listPromptTemplates();
    const names = prompts.map((prompt) => prompt.name);

    expect(names).toEqual([
      "policy-governance-101",
      "evidence-investigation",
      "gateway-integration-check",
      "escalation-review-brief",
      "mcp-client-hardening",
    ]);
  });

  it("renders gateway integration verification context", () => {
    const text = renderPromptTemplate("gateway-integration-check", {
      connector: "github",
      decision_id: "decision-123",
    });

    expect(text).toContain("github");
    expect(text).toContain("/api/gateway/decide");
    expect(text).toContain("/api/evidence");
    expect(text).toContain("decision-123");
  });

  it("renders client hardening guidance for HTTP/SSE operations", () => {
    const text = renderPromptTemplate("mcp-client-hardening", { client_name: "LangChain" });

    expect(text).toContain("LangChain");
    expect(text).toContain("workspace scoping");
    expect(text).toContain("session capacity");
  });

  it("throws for unknown prompts", () => {
    expect(() => renderPromptTemplate("missing", {})).toThrow("Unknown prompt");
  });
});
