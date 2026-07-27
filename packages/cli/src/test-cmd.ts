import * as fs from "node:fs";
import * as path from "node:path";
import { parseAgtPolicyDocument, evaluateDecision } from "@spctre/policy-schema";

type ExpectedOutcome = "ALLOW" | "DENY" | "WARN";

interface TestFixture {
  connector: string;
  action: string;
  domains?: string[];
  context?: Record<string, unknown>;
  agentContext?: Record<string, unknown>;
  expect: ExpectedOutcome;
  description?: string;
}

interface TestResult {
  fixture: TestFixture;
  pass: boolean;
  actual: string;
  reason: string;
  matchedRules: string[];
}

export interface TestReport {
  file: string;
  fixturesFile: string;
  results: TestResult[];
  passed: number;
  failed: number;
}

function loadFixtures(fixturesPath: string): TestFixture[] {
  let raw: string;
  try {
    raw = fs.readFileSync(fixturesPath, "utf8");
  } catch (err) {
    console.error(`Error: Could not read fixtures file ${fixturesPath}: ${String(err)}`);
    process.exit(1);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.error("Error: Fixtures file must be a JSON array.");
      process.exit(1);
    }
    return parsed as TestFixture[];
  } catch {
    console.error("Error: Fixtures file must be valid JSON.");
    process.exit(1);
  }
}

/**
 * Run tests against a policy file and return the report without any
 * printing or process.exit — useful for composing into spctre check.
 */
export async function runTests(policyPath: string, fixturesPath: string): Promise<TestReport> {
  let document: string;
  try {
    document = fs.readFileSync(policyPath, "utf8");
  } catch (err) {
    return { file: policyPath, fixturesFile: fixturesPath, results: [], passed: 0, failed: 1 };
  }

  const importResult = parseAgtPolicyDocument({ document, sourcePath: policyPath });
  const fixtures = loadFixtures(fixturesPath);
  const results: TestResult[] = fixtures.map((fixture) => {
    const evalResult = evaluateDecision({
      connector: fixture.connector,
      action: fixture.action,
      domains: fixture.domains ?? [],
      rules: importResult.rules,
    });
    return {
      fixture,
      pass: evalResult.status === fixture.expect,
      actual: evalResult.status,
      reason: evalResult.reason,
      matchedRules: evalResult.matchedRefs,
    };
  });

  return {
    file: policyPath,
    fixturesFile: fixturesPath,
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
  };
}

export async function testCmd(
  policyArg: string | undefined,
  options: { tests: string; format?: string }
): Promise<void> {
  // Resolve policy path
  const policyPath = policyArg
    ? path.resolve(process.cwd(), policyArg)
    : path.resolve(process.cwd(), "spctre-policy.json");

  if (!fs.existsSync(policyPath)) {
    console.error(`Error: Policy file not found: ${policyPath}`);
    process.exit(1);
  }

  let document: string;
  try {
    document = fs.readFileSync(policyPath, "utf8");
  } catch (err) {
    console.error(`Error: Could not read policy file: ${String(err)}`);
    process.exit(1);
  }

  const importResult = parseAgtPolicyDocument({ document, sourcePath: policyPath });

  const parseErrors = importResult.diagnostics.filter((d) => d.severity === "ERROR");
  if (parseErrors.length > 0) {
    console.error("Policy parse errors:");
    for (const e of parseErrors) console.error(`  error  ${e.message}`);
    process.exit(1);
  }

  if (importResult.rules.length === 0) {
    console.error("Warning: No rules found in policy file.");
  }

  // Resolve fixtures path
  const fixturesPath = path.resolve(process.cwd(), options.tests);
  const fixtures = loadFixtures(fixturesPath);

  if (fixtures.length === 0) {
    console.error("Warning: No test fixtures found.");
    process.exit(0);
  }

  const results: TestResult[] = [];

  for (const fixture of fixtures) {
    const evalResult = evaluateDecision({
      connector: fixture.connector,
      action: fixture.action,
      domains: fixture.domains ?? [],
      rules: importResult.rules,
    });

    results.push({
      fixture,
      pass: evalResult.status === fixture.expect,
      actual: evalResult.status,
      reason: evalResult.reason,
      matchedRules: evalResult.matchedRefs,
    });
  }

  const report: TestReport = {
    file: policyPath,
    fixturesFile: fixturesPath,
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
  };

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          file: report.file,
          fixturesFile: report.fixturesFile,
          total: results.length,
          passed: report.passed,
          failed: report.failed,
          results: results.map((r) => ({
            connector: r.fixture.connector,
            action: r.fixture.action,
            description: r.fixture.description,
            expected: r.fixture.expect,
            actual: r.actual,
            pass: r.pass,
            reason: r.reason,
            matchedRules: r.matchedRules,
          })),
        },
        null,
        2
      )
    );
  } else {
    for (const r of results) {
      const label = r.fixture.description ?? `${r.fixture.connector}.${r.fixture.action}`;
      const ruleHint = r.matchedRules.length > 0 ? `  (rule: ${r.matchedRules[0]})` : "";
      const outcome = `${r.actual}${ruleHint}`;
      if (r.pass) {
        console.log(`✓ ${label} → ${outcome}`);
      } else {
        console.log(`✗ ${label} → ${outcome}`);
        console.log(`  expected ${r.fixture.expect}: ${r.reason}`);
      }
    }

    console.log(`\n${report.passed} passed, ${report.failed} failed`);
  }

  if (report.failed > 0) process.exit(1);
}
