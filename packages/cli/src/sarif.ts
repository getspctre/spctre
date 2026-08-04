import * as path from "node:path";
import type { LintResult } from "./lint";
import type { TestReport } from "./test-cmd";
import { SPCTRE_VERSION } from "./version.js";

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: "error" | "warning" | "note" };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId: string };
      region?: { startLine: number };
    };
  }>;
}

interface SarifOutput {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: { driver: { name: string; version: string; informationUri: string; rules: SarifRule[] } };
    results: SarifResult[];
    artifacts: Array<{ location: { uri: string; uriBaseId: string }; mimeType: string }>;
  }>;
}

function fileUri(filePath: string): string {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  return rel.startsWith("..") ? filePath.replace(/\\/g, "/") : rel;
}

export function buildSarif(lintResult: LintResult, testReport: TestReport | null): SarifOutput {
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];
  const artifactUri = fileUri(lintResult.file);

  function ensureRule(id: string, name: string, level: "error" | "warning" | "note") {
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        name,
        shortDescription: { text: name },
        defaultConfiguration: { level },
      });
    }
  }

  for (const err of lintResult.parseErrors) {
    const ruleId = "spctre.parse";
    ensureRule(ruleId, "PolicyParseError", "error");
    results.push({
      ruleId,
      level: "error",
      message: { text: err },
      locations: [
        { physicalLocation: { artifactLocation: { uri: artifactUri, uriBaseId: "%SRCROOT%" } } },
      ],
    });
  }

  for (const d of lintResult.diagnostics) {
    const ruleId = d.ruleId ?? "spctre.lint";
    const level = d.severity === "error" ? "error" : "warning";
    ensureRule(ruleId, ruleId, level);
    results.push({
      ruleId,
      level,
      message: { text: d.message },
      locations: [
        { physicalLocation: { artifactLocation: { uri: artifactUri, uriBaseId: "%SRCROOT%" } } },
      ],
    });
  }

  if (testReport) {
    for (const r of testReport.results) {
      if (r.pass) continue;
      const ruleId = r.matchedRules[0] ?? "spctre.test.violation";
      ensureRule(ruleId, "PolicyTestViolation", "error");
      results.push({
        ruleId,
        level: "error",
        message: {
          text: `${r.fixture.connector}/${r.fixture.action}: expected ${r.fixture.expect}, got ${r.actual}. ${r.reason}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: fileUri(testReport.file), uriBaseId: "%SRCROOT%" },
            },
          },
        ],
      });
    }
  }

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "spctre",
            version: SPCTRE_VERSION,
            informationUri: "https://spctre.dev",
            rules: Array.from(rules.values()),
          },
        },
        results,
        artifacts: [
          { location: { uri: artifactUri, uriBaseId: "%SRCROOT%" }, mimeType: "application/json" },
        ],
      },
    ],
  };
}
