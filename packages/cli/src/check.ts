import * as path from "node:path";
import { readConfig } from "./config";
import { sync } from "./sync";
import { lintFile } from "./lint";
import { runTests } from "./test-cmd";
import { buildSarif } from "./sarif";
import { getOutputFormat, printJson, printProgress } from "./output";

function printTextReport(
  lintResult: Awaited<ReturnType<typeof lintFile>>,
  testReport: Awaited<ReturnType<typeof runTests>> | null,
  passed: boolean,
) {
  if (lintResult.parseErrors.length) {
    for (const err of lintResult.parseErrors) console.error(`  error: ${err}`);
  }
  for (const d of lintResult.diagnostics) {
    console.log(`  ${d.severity}: ${d.message}${d.ruleId ? `  [${d.ruleId}]` : ""}`);
  }
  if (testReport) {
    console.log(`\nTests: ${testReport.passed}/${testReport.results.length} passed`);
    for (const r of testReport.results.filter((r) => !r.pass)) {
      console.log(
        `  FAIL ${r.fixture.connector}/${r.fixture.action}: expected ${r.fixture.expect}, got ${r.actual}`,
      );
      if (r.reason) console.log(`       ${r.reason}`);
    }
  }
  if (passed) {
    console.log("Policy check passed.");
  }
}

export async function check(
  policyArg: string | undefined,
  options: { output?: string; tests?: string; noSync?: boolean; workspace?: string },
) {
  const format = getOutputFormat(options.output);
  const config = readConfig();
  const policyPath = path.resolve(
    process.cwd(),
    policyArg ?? config?.bundlePath ?? "spctre-policy.json",
  );

  if (!options.noSync) {
    printProgress("Syncing policy bundle...");
    const syncResult = await sync({ workspace: options.workspace, quiet: true });
    if (!syncResult) {
      // sync() already called process.exit(1) on failure; this is a fallback.
      process.exit(1);
    }
  }

  printProgress("Linting policy...");
  const lintResult = await lintFile(policyPath, {
    url: config?.controlPlaneUrl,
    token: config?.token,
  });

  let testReport = null;
  if (options.tests) {
    const fixturesPath = path.resolve(process.cwd(), options.tests);
    printProgress("Running policy tests...");
    testReport = await runTests(policyPath, fixturesPath);
  }

  const hasParseErrors = lintResult.parseErrors.length > 0;
  const hasViolations = !!testReport && testReport.failed > 0;

  if (format === "sarif") {
    process.stdout.write(JSON.stringify(buildSarif(lintResult, testReport), null, 2) + "\n");
  } else if (format === "json") {
    printJson({
      ok: !hasParseErrors && !hasViolations,
      file: lintResult.file,
      parseErrors: lintResult.parseErrors,
      diagnostics: lintResult.diagnostics,
      ruleCount: lintResult.ruleCount,
      tests: testReport
        ? { total: testReport.results.length, passed: testReport.passed, failed: testReport.failed }
        : null,
    });
  } else {
    printTextReport(lintResult, testReport, !hasParseErrors && !hasViolations);
  }

  // Exit codes: 0 = clean, 1 = internal/parse error, 2 = policy violations
  if (hasParseErrors) process.exit(1);
  if (hasViolations) process.exit(2);
}
