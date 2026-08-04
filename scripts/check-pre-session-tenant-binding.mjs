import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Repositories whose exported functions run on pre-session paths (login, SSO,
// OIDC/SAML callbacks, CLI/device onboarding) where no session-guard cookie has
// bound a tenant yet. On these paths the tenant-aware `sql` client resolves no
// tenant and, in a real multi-tenant deployment, throws "No tenant context is
// bound." (see apps/web/lib/db.ts). A trusted tenant that is already known must
// therefore be bound explicitly with `runWithTenantContext(tenantId, ...)`; a
// genuinely tenant-less lookup must use the owner connection `rawSql`.
//
// This guard flags any function in these files that queries the tenant-aware
// `sql` client without wrapping it in `runWithTenantContext`, unless the
// function is exempted below. It exists because the vitest suites mock
// `@/lib/db`, so this class of bug never surfaces in tests and only breaks once
// an environment stops handing out a default tenant (see the single-tenant
// fallback in db.ts).
const preSessionFiles = [
  "apps/web/lib/repositories/auth/session.ts",
  "apps/web/lib/repositories/auth/principal.ts",
  "apps/web/lib/repositories/auth/grants.ts",
  "apps/web/lib/repositories/onboarding/cli.ts",
  "apps/web/lib/repositories/onboarding/device.ts",
];

// `${file}::${function}` entries that legitimately use the tenant-aware `sql`
// client without a runWithTenantContext wrapper. Each must fall into one of:
//   - session-context: runs inside an authenticated request where the
//     session-guard cookie has already bound the tenant via resolveTenantContext.
//   - browser-approval: runs inside an authenticated approval request (has a
//     session), so the cookie binds the tenant.
//   - local-dev-bootstrap: reachable only from local-dev signup; the tenant is
//     being created in the same call, so there is no prior tenant to bind.
const exempt = new Map([
  // session.ts — authenticated session-context writes/reads.
  ["apps/web/lib/repositories/auth/session.ts::updateSessionForTenantSwitch", "session-context"],
  ["apps/web/lib/repositories/auth/session.ts::updateSessionForActorSwitch", "session-context"],
  ["apps/web/lib/repositories/auth/session.ts::listPrincipalSessions", "session-context"],
  ["apps/web/lib/repositories/auth/session.ts::revokeSessionAndRecord", "session-context"],
  ["apps/web/lib/repositories/auth/session.ts::fetchSessionForAuth", "session-context"],
  [
    "apps/web/lib/repositories/auth/session.ts::updateSessionAndPrincipalActivity",
    "session-context",
  ],
  ["apps/web/lib/repositories/auth/session.ts::revokeSessionRow", "session-context"],
  // principal.ts / grants.ts — local-dev signup bootstrap (creates the tenant).
  ["apps/web/lib/repositories/auth/principal.ts::upsertLocalDevPrincipal", "local-dev-bootstrap"],
  [
    "apps/web/lib/repositories/auth/principal.ts::ensureLocalDevTenantWorkspace",
    "local-dev-bootstrap",
  ],
  ["apps/web/lib/repositories/auth/grants.ts::upsertLocalDevWorkspaceGrant", "local-dev-bootstrap"],
  // onboarding — browser approval runs with an authenticated session.
  ["apps/web/lib/repositories/onboarding/cli.ts::approveCliOnboardingRequest", "browser-approval"],
  ["apps/web/lib/repositories/onboarding/device.ts::approveDeviceOnboarding", "browser-approval"],
]);

// A function "runs a tenant-scoped query on the tenant-aware sql client" when it
// references `sql` as a tagged/typed template, opens a `sql.begin` transaction,
// or defaults a query param to `sql`. `sql.json` is deliberately excluded: it is
// a pure value serializer that executes nothing and works on any client, so it
// is not a tenant-scoped read/write. `rawSql` (capital S) never matches these
// lowercase patterns, and `Boolean(sql)` / `if (!sql)` guards are excluded too.
const TENANT_SQL = /(?<![.\w])sql\s*[<`]|(?<![.\w])sql\.begin\b|\bdb\s*=\s*sql\b/;
const BINDING = /runWithTenantContext\s*[<(]/;
const FUNCTION_START = /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function functionBlocks(source) {
  const starts = [];
  let match;
  while ((match = FUNCTION_START.exec(source)) !== null) {
    starts.push({
      name: match[1],
      index: match.index,
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return starts.map((start, i) => ({
    name: start.name,
    line: start.line,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

const violations = [];
const unusedExemptions = new Set(exempt.keys());

for (const file of preSessionFiles) {
  const source = readFileSync(file, "utf8");
  for (const fn of functionBlocks(source)) {
    const key = `${file}::${fn.name}`;
    const usesTenantSql = TENANT_SQL.test(fn.body);
    if (!usesTenantSql) continue;
    if (exempt.has(key)) {
      unusedExemptions.delete(key);
      continue;
    }
    if (!BINDING.test(fn.body)) {
      violations.push({ file, name: fn.name, line: fn.line });
    }
  }
}

// Bearer-token routes do not have a session-guard cookie, so a route that
// authenticates a service token and calls a repository directly must also bind
// the token tenant around that work. Domain services are responsible for their
// own binding and are intentionally outside this check.
const bearerRepositoryExemptions = new Map([
  [
    "apps/web/app/api/gateway-ingest/_shared.ts",
    "pre-tenant webhook-secret lookup uses rawSql; tenant writes bind in ingestGatewayEvent",
  ],
]);

const bearerRouteViolations = [];
const unusedBearerExemptions = new Set(bearerRepositoryExemptions.keys());

for (const file of filesUnder("apps/web/app/api")) {
  const source = readFileSync(file, "utf8");
  const authenticatesServiceToken = source.includes("authenticateServiceToken(");
  const importsRepository = source.includes("@/lib/repositories/");
  if (!authenticatesServiceToken || !importsRepository) continue;

  if (bearerRepositoryExemptions.has(file)) {
    unusedBearerExemptions.delete(file);
    continue;
  }
  if (!BINDING.test(source)) bearerRouteViolations.push(file);
}

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error(
    "Pre-session repository functions must bind their tenant with runWithTenantContext\n" +
      "(or use the owner connection rawSql). Unbound tenant-aware sql on these paths\n" +
      'throws "No tenant context is bound" in multi-tenant deployments.\n',
  );
  for (const v of violations) console.error(`  - ${v.file}:${v.line} ${v.name}`);
}

if (unusedExemptions.size > 0) {
  failed = true;
  console.error(
    "\nStale entries in the pre-session tenant-binding exemption list " +
      "(no longer needed — remove them):\n",
  );
  for (const key of unusedExemptions) console.error(`  - ${key}`);
}

if (bearerRouteViolations.length > 0) {
  failed = true;
  console.error(
    "\nBearer-token routes that access repositories directly must bind the authenticated tenant " +
      "with runWithTenantContext before issuing tenant-scoped queries:\n",
  );
  for (const file of bearerRouteViolations) console.error(`  - ${file}`);
}

if (unusedBearerExemptions.size > 0) {
  failed = true;
  console.error("\nStale bearer-route tenant-binding exemptions (remove them):\n");
  for (const file of unusedBearerExemptions) console.error(`  - ${file}`);
}

if (failed) process.exit(1);

console.log(`Pre-session tenant-binding check passed (${preSessionFiles.length} files).`);
