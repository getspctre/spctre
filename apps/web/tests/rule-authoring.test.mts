import { describe, expect, it } from "vitest";
import {
  editableRuleFromRawJson,
  parseSemanticChecksText,
  rawJsonForRule,
  scopeVocabulary,
  serializeConstraints,
  toEditableRule,
} from "../app/review/rule-authoring-panel";
import { parseRulesPayload, unmodeledRuleFieldsMatch } from "../lib/domains/review/rule-authoring";
import type { PolicyRuleSummary } from "@spctre/policy-schema";
import type { AuthoringVocabularyEntry } from "../lib/domains/packs/service";

describe("Rule Authoring Logic", () => {
  describe("toEditableRule", () => {
    it("serializes semantic checks with their optional effects", () => {
      const mockRule: PolicyRuleSummary = {
        stableRuleId: "rule-1",
        title: "Test Rule",
        effect: "DENY",
        sourceFormat: "AGT_YAML",
        domains: [],
        connectors: [],
        actions: [],
        immutable: false,
        semanticChecks: [
          { id: "check-1", prompt: "first check" },
          { id: "check-2", prompt: "second check", effect: "WARN" },
          { id: "check-3", prompt: "third check", effect: "ALLOW" },
        ],
      };

      const editable = toEditableRule(mockRule);
      expect(editable.semanticChecksText).toBe(
        "first check\nsecond check -> WARN\nthird check -> ALLOW",
      );
      expect(editable.originalSemanticChecks).toEqual([
        { id: "check-1", prompt: "first check", effect: undefined },
        { id: "check-2", prompt: "second check", effect: "WARN" },
        { id: "check-3", prompt: "third check", effect: "ALLOW" },
      ]);
    });

    it("round-trips typed parameter constraints without loss", () => {
      const mockRule: PolicyRuleSummary = {
        stableRuleId: "stripe.refund.high_value_review",
        title: "Escalate high-value refunds",
        effect: "ESCALATE",
        sourceFormat: "AGT_YAML",
        domains: ["refunds"],
        connectors: ["stripe"],
        actions: ["refund.create"],
        immutable: false,
        parameterConstraints: [
          {
            field: "amount_cents",
            operator: "gte",
            value: 50000,
            parameterKey: "stripe.refund_review_threshold_cents",
            effect: "ESCALATE",
          },
        ],
      };

      const editable = toEditableRule(mockRule);
      expect(editable.parameterConstraints).toEqual([
        {
          field: "amount_cents",
          operator: "gte",
          valueText: "50000",
          effect: "ESCALATE",
          parameterKey: "stripe.refund_review_threshold_cents",
        },
      ]);

      // Re-serialize the untouched editable form and confirm the original
      // constraint is reproduced (the data-loss regression this guards against).
      expect(serializeConstraints(editable.parameterConstraints)).toEqual(
        mockRule.parameterConstraints,
      );
    });
  });

  describe("serializeConstraints", () => {
    it("coerces value text by operator: number, boolean, list, and string", () => {
      const result = serializeConstraints([
        {
          field: "amount_cents",
          operator: "gte",
          valueText: "50000",
          effect: "",
          parameterKey: "",
        },
        {
          field: "branch.protected",
          operator: "eq",
          valueText: "true",
          effect: "DENY",
          parameterKey: "",
        },
        {
          field: "region",
          operator: "in",
          valueText: "us-east-1, eu-west-1",
          effect: "",
          parameterKey: "",
        },
        { field: "ports", operator: "not_in", valueText: "22, 443", effect: "", parameterKey: "" },
        {
          field: "command",
          operator: "contains",
          valueText: "rm -rf",
          effect: "WARN",
          parameterKey: "",
        },
      ]);

      expect(result).toEqual([
        { field: "amount_cents", operator: "gte", value: 50000 },
        { field: "branch.protected", operator: "eq", value: true, effect: "DENY" },
        { field: "region", operator: "in", value: ["us-east-1", "eu-west-1"] },
        { field: "ports", operator: "not_in", value: [22, 443] },
        { field: "command", operator: "contains", value: "rm -rf", effect: "WARN" },
      ]);
    });

    it("drops constraint rows with an empty field", () => {
      const result = serializeConstraints([
        { field: "", operator: "gte", valueText: "1", effect: "", parameterKey: "" },
        { field: "amount", operator: "gt", valueText: "0", effect: "", parameterKey: "" },
      ]);
      expect(result).toEqual([{ field: "amount", operator: "gt", value: 0 }]);
    });
  });

  describe("scopeVocabulary", () => {
    const vocabulary: AuthoringVocabularyEntry[] = [
      {
        connector: "stripe",
        domains: ["refunds", "payments"],
        actions: ["refund.create", "payout.update_destination"],
        parameters: [
          {
            key: "stripe.refund_review_threshold_cents",
            label: "Refund threshold",
            type: "number",
            default: 50000,
          },
        ],
        constraintFields: ["amount_cents"],
      },
      {
        connector: "github",
        domains: ["repos"],
        actions: ["pr.merge"],
        parameters: [
          {
            key: "github.protected_branches",
            label: "Protected branches",
            type: "string",
            default: "main",
          },
        ],
        constraintFields: ["branch.protected"],
      },
    ];

    it("always offers every installed connector regardless of selection", () => {
      expect(scopeVocabulary(vocabulary, "").connectors).toEqual(["github", "stripe"]);
    });

    it("narrows actions/domains/fields/knobs to the selected connector", () => {
      const scoped = scopeVocabulary(vocabulary, "stripe");
      expect(scoped.actions).toEqual(["payout.update_destination", "refund.create"]);
      expect(scoped.domains).toEqual(["payments", "refunds"]);
      expect(scoped.constraintFields).toEqual(["amount_cents"]);
      expect(scoped.parameters.map((p) => p.key)).toEqual(["stripe.refund_review_threshold_cents"]);
    });

    it("widens action suggestions but withholds constraint helpers until a connector is selected", () => {
      const scoped = scopeVocabulary(vocabulary, "");
      expect(scoped.actions).toEqual(["payout.update_destination", "pr.merge", "refund.create"]);
      expect(scoped.constraintFields).toEqual([]);
      expect(scoped.parameters).toEqual([]);
    });

    it("withholds constraint helpers for an unrecognized manual connector", () => {
      const scoped = scopeVocabulary(vocabulary, "internal-tool");
      expect(scoped.constraintFields).toEqual([]);
      expect(scoped.parameters).toEqual([]);
    });

    it("matches connectors case-insensitively", () => {
      expect(scopeVocabulary(vocabulary, "STRIPE").constraintFields).toEqual(["amount_cents"]);
    });
  });

  describe("raw JSON escape hatch", () => {
    const base: PolicyRuleSummary = {
      stableRuleId: "stripe.refund.high_value_review",
      title: "Escalate high-value refunds",
      effect: "ESCALATE",
      sourceFormat: "AGT_YAML",
      domains: ["refunds"],
      connectors: ["stripe"],
      actions: ["refund.create"],
      immutable: false,
      parameterConstraints: [{ field: "amount_cents", operator: "gte", value: 50000 }],
      // A field the form does not surface — must survive the round-trip.
      priority: 7,
    };

    it("round-trips a rule through raw JSON without losing unmodeled fields", () => {
      const editable = toEditableRule(base);
      const json = rawJsonForRule(editable);
      const result = editableRuleFromRawJson(json, editable);
      expect("rule" in result).toBe(true);
      if (!("rule" in result)) return;
      // Re-serialize and confirm the constraint and unmodeled priority survive.
      const reserialized = JSON.parse(rawJsonForRule(result.rule));
      expect(reserialized.parameterConstraints).toEqual([
        { field: "amount_cents", operator: "gte", value: 50000 },
      ]);
      expect(reserialized.priority).toBe(7);
      expect(reserialized.effect).toBe("ESCALATE");
    });

    it("lets raw edits reach fields the form does not surface", () => {
      const editable = toEditableRule(base);
      const edited = JSON.stringify({ ...JSON.parse(rawJsonForRule(editable)), priority: 99 });
      const result = editableRuleFromRawJson(edited, editable);
      if (!("rule" in result)) throw new Error("expected success");
      expect(JSON.parse(rawJsonForRule(result.rule)).priority).toBe(99);
    });

    it("rejects invalid JSON and non-object payloads", () => {
      const editable = toEditableRule(base);
      expect(editableRuleFromRawJson("{ not json", editable)).toEqual({
        error: expect.stringContaining("not valid"),
      });
      expect(editableRuleFromRawJson("[]", editable)).toEqual({
        error: expect.stringContaining("single object"),
      });
    });

    it("preserves inherited-immutable status from the base rule", () => {
      const locked = toEditableRule({ ...base, immutable: true });
      const result = editableRuleFromRawJson(rawJsonForRule(locked), locked);
      if (!("rule" in result)) throw new Error("expected success");
      expect(result.rule.inheritedImmutable).toBe(true);
    });
  });

  describe("parseSemanticChecksText", () => {
    const originalChecks = [
      { id: "sem-rule-1", prompt: "first check" },
      { id: "sem-rule-2", prompt: "second check", effect: "WARN" as const },
    ];

    it("preserves IDs exactly when prompts and effects are unchanged", () => {
      const text = "first check\nsecond check -> WARN";
      const result = parseSemanticChecksText(text, "rule-1", originalChecks);

      expect(result).toEqual([
        { id: "sem-rule-1", prompt: "first check", effect: undefined },
        { id: "sem-rule-2", prompt: "second check", effect: "WARN" },
      ]);
    });

    it("preserves IDs when only the effect changes", () => {
      const text = "first check -> DENY\nsecond check -> ALLOW";
      const result = parseSemanticChecksText(text, "rule-1", originalChecks);

      expect(result).toEqual([
        { id: "sem-rule-1", prompt: "first check", effect: "DENY" },
        { id: "sem-rule-2", prompt: "second check", effect: "ALLOW" },
      ]);
    });

    it("preserves IDs at corresponding positions when prompt text changes", () => {
      const text = "new first prompt\nsecond check -> WARN";
      const result = parseSemanticChecksText(text, "rule-1", originalChecks);

      expect(result).toEqual([
        { id: "sem-rule-1", prompt: "new first prompt", effect: undefined },
        { id: "sem-rule-2", prompt: "second check", effect: "WARN" },
      ]);
    });

    it("generates unique new IDs for newly added lines", () => {
      const text = "first check\nsecond check -> WARN\nbrand new third check";
      const result = parseSemanticChecksText(text, "rule-1", originalChecks);

      expect(result).toEqual([
        { id: "sem-rule-1", prompt: "first check", effect: undefined },
        { id: "sem-rule-2", prompt: "second check", effect: "WARN" },
        { id: "rule-1-sc-3", prompt: "brand new third check", effect: undefined },
      ]);
    });

    it("avoids ID conflicts when generating new IDs", () => {
      // If original contains a check named rule-1-sc-3, the generator must skip it
      const originalWithConflict = [...originalChecks, { id: "rule-1-sc-3", prompt: "some other" }];
      const text = "first check\nsecond check -> WARN\nsome other\nnew check";
      const result = parseSemanticChecksText(text, "rule-1", originalWithConflict);

      expect(result[2].id).toBe("rule-1-sc-3");
      expect(result[3].id).toBe("rule-1-sc-4"); // rule-1-sc-3 is already used, so it generates 4
    });
  });

  // End-to-end parity: an untouched inherited-immutable rule must survive the
  // real client serialize -> server normalize round-trip and still satisfy the
  // strengthened immutability guard (unmodeled fields included). If this fails,
  // the guard would block every legitimate commit on a branch with immutable
  // rules.
  describe("immutable rule round-trip parity", () => {
    const baseline: PolicyRuleSummary = {
      stableRuleId: "org.identity.block_unnamed_principal",
      title: "Block embedded agent actions without a named versioned agent principal",
      effect: "DENY",
      sourceFormat: "AGT_YAML",
      sourcePath: "packs/spctre-agent-governance-v1.json",
      domains: ["agent-actions", "audit"],
      connectors: ["spctre-agent"],
      actions: ["agent.unnamed_action", "agent.unversioned_action", "agent.missing_principal"],
      immutable: true,
      conditions: [],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC6.1",
          rationale: "Access control for governed tool use",
        },
      ],
      // AGT-native provenance the form never surfaces.
      originalRule: {
        stable_rule_id: "org.identity.block_unnamed_principal",
        agt_native: true,
        priority: 3,
      },
    };

    function roundTrip(base: PolicyRuleSummary) {
      const json = rawJsonForRule(toEditableRule(base)); // client serialize
      const parsed = parseRulesPayload(JSON.stringify([JSON.parse(json)])); // server normalize
      if (!("rules" in parsed)) throw new Error("normalize failed");
      return parsed.rules[0];
    }

    it("passes the guard for an unchanged immutable rule", () => {
      const candidate = roundTrip(baseline);
      expect(
        unmodeledRuleFieldsMatch(baseline as unknown as Record<string, unknown>, candidate),
      ).toBe(true);
    });

    it("catches tampering with an unmodeled AGT-native field after the round-trip", () => {
      // Simulate a raw-JSON edit that flips a preserved AGT-native field.
      const tampered = roundTrip(baseline) as Record<string, unknown>;
      tampered.originalRule = {
        stable_rule_id: "org.identity.block_unnamed_principal",
        agt_native: false,
        priority: 3,
      };
      expect(
        unmodeledRuleFieldsMatch(baseline as unknown as Record<string, unknown>, tampered),
      ).toBe(false);
    });
  });
});
