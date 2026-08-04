import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const checkedRoots = ["apps/web/app", "apps/web/lib"];
const allowedMockDataConsumers = new Set([
  "apps/web/app/compliance/demo-compliance-fallback.ts",
  "apps/web/app/review/review-page-model.ts",
  "apps/web/app/rules/demo-rules-fallback.ts",
  "apps/web/lib/repositories/demo-fallbacks.ts",
  "apps/web/lib/mock-data.ts",
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walk(fullPath);
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) {
      yield fullPath;
    }
  }
}

function importsMockData(source) {
  return (
    source.includes("@/lib/mock-data") ||
    source.includes("../lib/mock-data") ||
    source.includes("./mock-data")
  );
}

const violations = [];

for (const root of checkedRoots) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const hasInlineMockConstant = /\bconst\s+MOCK_[A-Z0-9_]*\b/.test(source);
    if (!importsMockData(source) && !hasInlineMockConstant) continue;

    if (importsMockData(source) && !allowedMockDataConsumers.has(file)) {
      violations.push(`${file}: imports mock-data outside the audited demo-fallback allowlist`);
      continue;
    }

    if (hasInlineMockConstant && !allowedMockDataConsumers.has(file)) {
      violations.push(
        `${file}: defines inline MOCK_* sample data outside the audited demo-fallback allowlist`,
      );
      continue;
    }

    if (file !== "apps/web/lib/mock-data.ts" && !source.includes("canUseDemoFallbackData")) {
      violations.push(
        `${file}: sample fallback data must be gated with canUseDemoFallbackData(...)`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Demo/mock fallback boundary check failed.");
  console.error("Sample data may only be exposed through audited demo-tenant fallback gates.\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log("Demo/mock fallback boundary check passed.");
