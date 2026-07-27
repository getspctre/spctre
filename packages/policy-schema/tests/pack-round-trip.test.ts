import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateDecision, packToDocument, parseAgtPolicyDocument, POLICY_PACKS } from "../src/index";
import type { RuntimeDecisionStatus } from "../src/index";

describe("pack install round-trip", () => {
  it("preserves semanticChecks, parameterConstraints, and controlMappings through packToDocument -> parseAgtPolicyDocument", () => {
    const pack = POLICY_PACKS.find((p) => p.connector === "stripe")!;
    const document = packToDocument(pack);
    const parsed = parseAgtPolicyDocument({ document, sourcePath: "packs/stripe-v1.json" });

    const refundRule = parsed.rules.find((r) => r.stableRuleId === "stripe.refund.high_value_review");
    expect(refundRule?.parameterConstraints).toEqual([
      { field: "amount_cents", operator: "gte", value: 50000, parameterKey: "stripe.refund_review_threshold_cents", effect: undefined },
    ]);
    expect(refundRule?.controlMappings).toEqual([{ framework: "SOC2", controlId: "CC6.1", rationale: "Reviews high-value financial transactions before execution." }]);

    const zendesk = POLICY_PACKS.find((p) => p.connector === "zendesk")!;
    const zendeskDoc = packToDocument(zendesk);
    const zendeskParsed = parseAgtPolicyDocument({ document: zendeskDoc, sourcePath: "packs/zendesk-v1.json" });
    const replyRule = zendeskParsed.rules.find((r) => r.stableRuleId === "zendesk.reply.pii_exposure.warn");
    expect(replyRule?.semanticChecks).toEqual([
      { id: "zendesk-reply-sc-1", prompt: "check for pii or regulated data exposure in customer reply", effect: "WARN" },
    ]);
  });

  it("preserves the pack's parameters catalog (nested under metadata) through the same round-trip", () => {
    const pack = POLICY_PACKS.find((p) => p.connector === "stripe")!;
    expect(pack.parameters).toBeDefined();
    const document = packToDocument(pack);
    const parsed = parseAgtPolicyDocument({ document, sourcePath: "packs/stripe-v1.json" });

    expect(parsed.metadata.parameters).toEqual(pack.parameters);
  });

  it("serializes non-core rule fields losslessly (priority / conditions / extended targeting)", () => {
    // A synthetic pack rule that exercises fields packToDocument used to drop:
    // priority, conditions, and an extended typed targeting field. Installing a
    // pack must not silently discard authored provenance at the pack->document
    // boundary.
    const pack = {
      id: "synthetic-v1",
      name: "Synthetic Governance Pack",
      connector: "synthetic",
      description: "Fixture pack exercising non-core rule fields.",
      riskLevel: "HIGH" as const,
      tags: ["synthetic"],
      domains: ["things"],
      metadata: { name: "Synthetic Governance Pack", version: "1.0.0" },
      rules: [
        {
          stableRuleId: "synthetic.guard",
          title: "Guard",
          effect: "DENY" as const,
          domains: ["things"],
          connectors: ["synthetic"],
          actions: ["thing.delete"],
          immutable: true,
          priority: 7,
          conditions: [{ field: "action", operator: "eq", value: "thing.delete" }],
          trustLevels: ["untrusted"],
          parameterConstraints: [{ field: "count", operator: "gte" as const, value: 10 }],
        },
      ],
    };

    const parsed = parseAgtPolicyDocument({ document: packToDocument(pack), sourcePath: "packs/synthetic-v1.json" });
    const rule = parsed.rules.find((r) => r.stableRuleId === "synthetic.guard");
    expect(rule?.priority).toBe(7); // core field previously dropped
    expect(rule?.parameterConstraints?.[0]?.value).toBe(10);
    // Extended typed fields are unknown to the parser, so they survive in
    // preservedFields — but they survive, rather than being dropped at install.
    expect(rule?.preservedFields?.trustLevels).toEqual(["untrusted"]);
  });

  it("round-trips a rule's dynamicConditions through pack -> document -> parse (AGT-native + condition source)", () => {
    // dynamicConditions is a parser-derived projection; the serializer re-emits
    // the AGT-native SOURCE each was built from so the parser reconstructs it,
    // rather than dropping the derived key. Exercise both source kinds.
    const timeWindow = { start: "09:00", end: "17:00", timezone: "UTC" };
    const pack = {
      id: "dyn-v1",
      name: "Dynamic Conditions Pack",
      connector: "dyn",
      description: "Fixture pack exercising dynamicConditions provenance.",
      riskLevel: "HIGH" as const,
      tags: ["dyn"],
      domains: ["things"],
      metadata: { name: "Dynamic Conditions Pack", version: "1.0.0" },
      rules: [
        {
          stableRuleId: "dyn.guard",
          title: "Guard",
          effect: "DENY" as const,
          domains: ["things"],
          connectors: ["dyn"],
          actions: ["thing.run"],
          immutable: false,
          dynamicConditions: [
            {
              kind: "TIME_WINDOW" as const,
              source: "AGT_NATIVE_FIELD" as const,
              value: timeWindow,
              window: timeWindow,
              originalCondition: { time_window: timeWindow },
            },
            {
              kind: "PER_CALL_COST_LIMIT" as const,
              source: "AGT_CONDITION" as const,
              field: "estimated_cost_usd",
              operator: "gte",
              value: 5,
              originalCondition: { field: "estimated_cost_usd", operator: "gte", value: 5 },
            },
          ],
        },
      ],
    };

    const parsed = parseAgtPolicyDocument({ document: packToDocument(pack), sourcePath: "packs/dyn-v1.json" });
    const rule = parsed.rules.find((r) => r.stableRuleId === "dyn.guard");
    const kinds = (rule?.dynamicConditions ?? []).map((c) => c.kind).sort();
    expect(kinds).toEqual(["PER_CALL_COST_LIMIT", "TIME_WINDOW"]);
    const timeCondition = rule?.dynamicConditions?.find((c) => c.kind === "TIME_WINDOW");
    expect(timeCondition?.value).toEqual(timeWindow); // native-field source reconstructed, not lost
    const costCondition = rule?.dynamicConditions?.find((c) => c.kind === "PER_CALL_COST_LIMIT");
    expect(costCondition?.value).toBe(5); // condition source folded into `conditions` and reclassified
  });
});

// Legacy serializer: the exact rule shape packToDocument emitted before this
// change (a fixed field subset, stable_rule_id first). Reproduced here so we can
// assert BYTE-FOR-BYTE equality for canonical packs whose rules carry only the
// previously-serialized fields — locking that the lossless rewrite did not churn
// any existing pack's serialized source document or its derived source_hash.
function legacyPackToDocument(pack: (typeof POLICY_PACKS)[number]): string {
  return JSON.stringify(
    {
      metadata: pack.parameters ? { ...pack.metadata, parameters: pack.parameters } : pack.metadata,
      rules: pack.rules.map((r) => ({
        stable_rule_id: r.stableRuleId,
        title: r.title,
        effect: r.effect,
        domains: r.domains,
        connectors: r.connectors,
        actions: r.actions,
        immutable: r.immutable,
        ...(r.semanticChecks ? { semantic_checks: r.semanticChecks } : {}),
        ...(r.parameterConstraints ? { parameter_constraints: r.parameterConstraints } : {}),
        ...(r.controlMappings ? { control_mappings: r.controlMappings } : {}),
      })),
    },
    null,
    2
  );
}

const CANONICAL_CONNECTORS = ["stripe", "postgresql", "github", "kubernetes", "zendesk"];

describe("packToDocument byte-identity for canonical packs (no source_hash churn)", () => {
  for (const connector of CANONICAL_CONNECTORS) {
    it(`${connector} serializes byte-for-byte identically to the legacy serializer`, () => {
      const pack = POLICY_PACKS.find((p) => p.connector === connector)!;
      expect(packToDocument(pack)).toBe(legacyPackToDocument(pack));
    });
  }
});

interface PackFixture {
  action: string;
  domains?: string[];
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  expected: { status: RuntimeDecisionStatus; matchedRefs: string[] };
}

const FIXTURES_ROOT = join(__dirname, "fixtures", "packs");
const CONNECTORS_WITH_FIXTURES = ["stripe", "postgresql", "github", "kubernetes", "zendesk"];

// Fixtures are the pack's regression proof (roadmap NOW: "regression fixtures
// that prove expected decisions"). Guarantee #1 requires installation to
// preserve fixture provenance, so the decisions must still hold once a pack has
// been round-tripped through the install serializer (packToDocument) and the DB
// read path (parseAgtPolicyDocument reparsing the persisted source_document).
describe("pack install round-trip preserves fixture provenance", () => {
  for (const connector of CONNECTORS_WITH_FIXTURES) {
    const pack = POLICY_PACKS.find((p) => p.connector === connector)!;
    // Full install round-trip: pack -> document -> parse (persisted rules) ->
    // re-serialize the persisted document -> parse again (the DB read path).
    const installParsed = parseAgtPolicyDocument({ document: packToDocument(pack), sourcePath: `packs/${pack.id}.json` });
    const reparsed = parseAgtPolicyDocument({
      document: JSON.stringify(installParsed.sourceDocument),
      sourcePath: `packs/${pack.id}.json`,
    });
    const roundTrippedRules = reparsed.rules;

    for (const fileName of readdirSync(join(FIXTURES_ROOT, connector)).filter((f) => f.endsWith(".json"))) {
      const fixture = JSON.parse(readFileSync(join(FIXTURES_ROOT, connector, fileName), "utf-8")) as PackFixture;
      it(`${connector}/${fileName} decides the same after install round-trip`, () => {
        const result = evaluateDecision({
          connector,
          action: fixture.action,
          domains: fixture.domains,
          rules: roundTrippedRules,
          toolIntent: fixture.toolIntent,
          planSummary: fixture.planSummary,
          toolParameters: fixture.toolParameters,
        });
        expect(result.status).toBe(fixture.expected.status);
        expect(result.matchedRefs.sort()).toEqual([...fixture.expected.matchedRefs].sort());
      });
    }
  }
});
