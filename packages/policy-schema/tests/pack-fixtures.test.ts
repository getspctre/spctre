import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateDecision, POLICY_PACKS } from "../src/index";
import type { PolicyRuleSummary, RuntimeDecisionStatus } from "../src/index";

interface PackFixture {
  description: string;
  action: string;
  domains?: string[];
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  expected: { status: RuntimeDecisionStatus; matchedRefs: string[] };
}

const FIXTURES_ROOT = join(__dirname, "fixtures", "packs");

function loadFixtures(connector: string): { fileName: string; fixture: PackFixture }[] {
  const dir = join(FIXTURES_ROOT, connector);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((fileName) => ({
      fileName,
      fixture: JSON.parse(readFileSync(join(dir, fileName), "utf-8")) as PackFixture,
    }));
}

function rulesForConnector(connector: string): PolicyRuleSummary[] {
  const pack = POLICY_PACKS.find((p) => p.connector === connector);
  if (!pack) throw new Error(`No pack registered for connector: ${connector}`);
  return pack.rules.map((rule) => ({ ...rule, sourceFormat: "SPCTRE_MANAGED" }));
}

const CONNECTORS_WITH_FIXTURES = ["stripe", "postgresql", "github", "kubernetes", "zendesk"];

describe("high-risk connector pack fixtures", () => {
  for (const connector of CONNECTORS_WITH_FIXTURES) {
    const rules = rulesForConnector(connector);
    for (const { fileName, fixture } of loadFixtures(connector)) {
      it(`${connector}/${fileName}: ${fixture.description}`, () => {
        const result = evaluateDecision({
          connector,
          action: fixture.action,
          domains: fixture.domains,
          rules,
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
