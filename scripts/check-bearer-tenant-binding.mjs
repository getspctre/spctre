import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Domain functions reached by a bearer-authenticated route must bind the tenant
// themselves.
//
// A cookie request has already had its tenant bound by the session guard, so a
// domain function can query the tenant-aware `sql` client without doing anything
// and it works. A bearer request has not: the tenant is only known once the
// token is authenticated, inside the route. An unbound query then throws
// "Bearer-token database work requires an explicit tenant context", which
// surfaces as a 500 — after authentication succeeded, so it reads as a server
// fault rather than a missing wrapper.
//
// This is the sibling of check-pre-session-tenant-binding.mjs and exists for the
// same reason: the vitest suites mock `@/lib/db`, so the guard never fires in
// tests and every route looks fine until a real token reaches it. Converting
// four session-only reads to accept service tokens shipped exactly this bug on
// three of them; /api/adapters answered 500 to the MCP server in staging while
// its unit tests passed.
//
// The rule: if a bearer-capable route imports a domain function, and that
// function takes a tenantId, it must wrap its work in runWithTenantContext.

const ROUTES_ROOT = "apps/web/app/api";
const DOMAINS_ROOT = "apps/web/lib/domains";

// `${file}::${function}` entries that take a tenantId but legitimately need no
// wrapper — a function that only forwards to another domain function which
// binds, or one that performs no query at all.
const exempt = new Map([
  // POST /api/adapters is session-only; the GET in the same file takes a bearer
  // token, and this scan reads a route file whole, so the write is caught by
  // its neighbour. Declaring an adapter stays an operator action.
  [
    "apps/web/lib/domains/packs/service.ts::upsertAdapterDeclarationForWorkspace",
    "session-only-write",
  ],
]);

const BEARER_ROUTE = /resolveRouteScope\s*\(|authenticateServiceToken\s*\(/;
const BINDING = /runWithTenantContext\s*[<(]/;
const TENANT_PARAM = /\btenantId\b/;

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Exported declarations, by name, as source chunks.
 *
 * Deliberately not brace-matched. Finding a body's opening brace means telling
 * it apart from an inline parameter type and from a return type such as
 * `Promise<{ erasedCount: number }>`, and each attempt at that mis-parsed some
 * function and reported it as unwrapped — a guard that cries wolf is worse than
 * no guard. Splitting on top-level `export` boundaries needs no parsing.
 *
 * The chunk may run past the function into non-exported helpers below it, which
 * can hide a missing wrapper rather than invent one. That is the safe direction
 * for a check that gates merges.
 */
function functionBlocks(source) {
  const blocks = new Map();
  const boundaries = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)];
  for (const [index, match] of boundaries.entries()) {
    const next = boundaries[index + 1];
    blocks.set(match[1], source.slice(match.index, next ? next.index : source.length));
  }
  return blocks;
}

/**
 * Domain identifiers imported by bearer-capable routes, each mapped to whether
 * every importing route binds the tenant itself.
 *
 * Binding at the route is equally correct — several routes wrap the call rather
 * than the domain function — so a function is only a finding when at least one
 * route reaches it with nothing bound on either side.
 */
function domainImportsFromBearerRoutes() {
  const boundByEveryRoute = new Map();
  for (const file of filesUnder(ROUTES_ROOT)) {
    if (!file.endsWith("route.ts")) continue;
    const source = readFileSync(file, "utf8");
    if (!BEARER_ROUTE.test(source)) continue;
    const routeBinds = BINDING.test(source);
    for (const match of source.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*"@\/lib\/domains\/[^"]+"/g,
    )) {
      for (const name of match[1].split(",")) {
        const identifier = name
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (!identifier) continue;
        boundByEveryRoute.set(
          identifier,
          (boundByEveryRoute.get(identifier) ?? true) && routeBinds,
        );
      }
    }
  }
  return boundByEveryRoute;
}

const wanted = domainImportsFromBearerRoutes();
if (wanted.size === 0) {
  console.error("No bearer-capable routes found importing domain functions; the scan is broken.");
  process.exit(1);
}

const violations = [];
let checked = 0;

for (const file of filesUnder(DOMAINS_ROOT)) {
  const source = readFileSync(file, "utf8");
  for (const [name, body] of functionBlocks(source)) {
    if (!wanted.has(name)) continue;
    if (!TENANT_PARAM.test(body)) continue;
    checked++;
    if (BINDING.test(body)) continue;
    if (wanted.get(name)) continue; // every route reaching it binds instead
    if (exempt.has(`${file}::${name}`)) continue;
    violations.push(`${file}::${name}`);
  }
}

if (violations.length) {
  console.error("Bearer-reachable domain functions that do not bind a tenant:\n");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    "\nWrap the work in runWithTenantContext(tenantId, ...). A bearer request has no" +
      "\nbound tenant, so the query throws after authentication and answers 500." +
      "\nIf the function genuinely needs no wrapper, add it to `exempt` with a reason.",
  );
  process.exit(1);
}

console.log(`Bearer tenant-binding check passed (${checked} bearer-reachable function(s)).`);
