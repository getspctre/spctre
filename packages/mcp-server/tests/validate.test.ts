import { describe, expect, it } from "vitest";
import {
  validateToolArgs,
  McpToolValidationError,
} from "../src/tools/validate.js";

describe("validateToolArgs", () => {
  it("returns typed args when they satisfy the advertised schema", () => {
    const args = {
      connector: "slack",
      action: "post_message",
      agent_context: { agent_id: "a1", workspace_id: "ws1" },
    };
    expect(validateToolArgs("evaluate_policy", args)).toBe(args);
  });

  it("throws when a required field is missing", () => {
    expect(() =>
      // agent_context is required by the evaluate_policy schema
      validateToolArgs("evaluate_policy", { connector: "slack", action: "post" }),
    ).toThrow(McpToolValidationError);
  });

  it("throws when a nested required field is missing", () => {
    expect(() =>
      validateToolArgs("evaluate_policy", {
        connector: "slack",
        action: "post",
        agent_context: { agent_id: "a1" }, // missing workspace_id
      }),
    ).toThrow(McpToolValidationError);
  });

  it("throws when an enum value is not allowed", () => {
    expect(() =>
      validateToolArgs("create_evidence_record", {
        decision_id: "d1",
        connector: "slack",
        action: "post",
        agent_context: { agent_id: "a1", workspace_id: "ws1" },
        outcome: "NOT_A_REAL_OUTCOME",
      }),
    ).toThrow(McpToolValidationError);
  });

  it("accepts the reconciled enum values the handlers actually support", () => {
    // risk_level CRITICAL and environment production were previously advertised
    // as invalid but supported/used by the handlers; validation must allow them.
    expect(() =>
      validateToolArgs("evaluate_policy", {
        connector: "slack",
        action: "post",
        agent_context: { agent_id: "a1", workspace_id: "ws1", environment: "production" },
        risk_level: "CRITICAL",
      }),
    ).not.toThrow();
  });

  it("passes through tools that advertise no schema constraints", () => {
    const args = { anything: true };
    expect(validateToolArgs("get_compliance_status", args)).toBe(args);
  });

  it("treats undefined args as an empty object", () => {
    // list_pending_escalations has no required fields, so undefined is valid.
    expect(() => validateToolArgs("list_pending_escalations", undefined)).not.toThrow();
  });
});
