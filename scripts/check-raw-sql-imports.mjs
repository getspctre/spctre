import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const allowed = new Set([
  "apps/web/app/api/auth/magic/route.ts",
  "apps/web/app/api/auth/recovery/verify/route.ts",
  "apps/web/lib/auth-rate-limit.ts",
  "apps/web/lib/db.ts",
  "apps/web/lib/repositories/auth/principal.ts",
  "apps/web/lib/repositories/auth/recovery.ts",
  "apps/web/lib/repositories/auth/service-tokens.ts",
  "apps/web/lib/repositories/bundle-export-log.ts",
  "apps/web/lib/repositories/economic.ts",
  "apps/web/lib/repositories/evidence/runtime.ts",
  "apps/web/lib/repositories/gateway-webhook.ts",
  "apps/web/lib/repositories/identity.ts",
  "apps/web/lib/repositories/mfa.ts",
  "apps/web/lib/repositories/operations-log/log.ts",
  "apps/web/lib/repositories/packs.ts",
  "apps/web/lib/repositories/policy/rules.ts",
  "apps/web/lib/repositories/scim-token.ts",
  "apps/web/lib/repositories/trust.ts",
  "apps/web/lib/repositories/verification.ts",
  "apps/web/lib/repositories/workspace/commercial.ts",
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

const offenders = ["apps/web/app", "apps/web/lib"]
  .flatMap((dir) => Array.from(walk(dir)))
  .filter((file) => readFileSync(file, "utf8").includes("rawSql"))
  .filter((file) => !allowed.has(file));

if (offenders.length > 0) {
  console.error("rawSql imports/usages are restricted to audited allowlisted files.");
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}
