import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Every API route must have its proxy posture written down.
//
// proxy.ts applies two independent gates — a session gate and a source-IP
// allowlist — and lib/proxy-paths.ts names the paths excused from each.
// proxy-path-invariants.test.mts then checks those sets against each other.
//
// The gap that check cannot see: it iterates over paths that are already in a
// set, so a route in no set is invisible to all of it. It catches contradictions
// between the lists and never omissions from them, and an omission is silent
// twice over — the runtime default is "gated", which is right for most routes
// and fails closed for the rest, so a bootstrap endpoint that nobody listed
// answers 401 and reads like an auth problem. That is how the billing webhook,
// the internal provisioning API, and the whole device flow each shipped
// unreachable.
//
// So this check runs the other way: enumerate the routes that exist on disk and
// require each to appear in proxy-path-inventory.json with a declared posture.
// Adding a route now fails CI until someone says what it is. For routes whose
// path has no dynamic segment, the declared posture is also compared against
// what proxy-paths.ts actually implements, so the inventory cannot drift into
// fiction.
//
// Run with --write to regenerate the inventory from the current configuration.
// Read the diff: --write records what the proxy does today, which is only the
// same as what it should do if someone has checked.

const ROUTES_ROOT = "apps/web/app/api";
const PROXY_PATHS = "apps/web/lib/proxy-paths.ts";
const INVENTORY = "scripts/proxy-path-inventory.json";

function routeFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

/** `apps/web/app/api/agents/[id]/trust/route.ts` -> `/api/agents/[id]/trust` */
function routePathname(file) {
  const segments = relative(ROUTES_ROOT, file).split(sep);
  segments.pop(); // route.ts
  return ["/api", ...segments].join("/").replace(/\/+$/, "") || "/api";
}

/**
 * String literals from a named `new Set([...])` or `[...]` export.
 *
 * Deliberately textual: proxy-paths.ts is import-free so it can run on the edge
 * runtime, and importing TypeScript from a plain .mjs check would need a build
 * step that this script exists to avoid depending on.
 */
function literalsOf(source, exportName) {
  const match = new RegExp(
    `export const ${exportName}\\s*(?::[^=]+)?=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`,
  ).exec(source);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function actualPosture(pathname, sets) {
  const sessionExempt =
    sets.serviceApiPaths.includes(pathname) ||
    sets.serviceApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  const sourceIpExempt =
    sets.machineApiPaths.includes(pathname) ||
    sets.machineApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  return {
    sessionGate: sessionExempt ? "exempt" : "gated",
    sourceIpGate: sourceIpExempt ? "exempt" : "restricted",
  };
}

const source = readFileSync(PROXY_PATHS, "utf8");
// Both prefix lists reference PUBLIC_API_PREFIX by identifier rather than
// repeating the literal, so a textual read of them comes back one entry short —
// and the missing entry is the published API, which is the single largest group
// of routes. Resolve it explicitly.
const publicApiPrefix = literalsOf(source, "PUBLIC_API_PREFIX_LITERAL").concat(
  (/export const PUBLIC_API_PREFIX\s*=\s*"([^"]+)"/.exec(source) ?? []).slice(1),
);

const sets = {
  serviceApiPaths: literalsOf(source, "SERVICE_API_PATHS"),
  serviceApiPrefixes: [...literalsOf(source, "SERVICE_API_PATH_PREFIXES"), ...publicApiPrefix],
  machineApiPaths: literalsOf(source, "MACHINE_API_PATHS"),
  machineApiPrefixes: publicApiPrefix,
};

if (!sets.serviceApiPaths.length || !sets.machineApiPaths.length || !publicApiPrefix.length) {
  console.error(
    `Proxy path coverage: could not read the path sets from ${PROXY_PATHS}. ` +
      `If the export shape changed, update literalsOf() rather than deleting this check.`,
  );
  process.exit(1);
}

const pathnames = routeFiles(ROUTES_ROOT).map(routePathname).sort();
const write = process.argv.includes("--write");

if (write) {
  const generated = Object.fromEntries(
    pathnames.map((pathname) => [pathname, actualPosture(pathname, sets)]),
  );
  writeFileSync(INVENTORY, `${JSON.stringify(generated, null, 2)}\n`);
  console.log(
    `Proxy path inventory written: ${pathnames.length} routes. Run \`pnpm format\` before committing.`,
  );
  process.exit(0);
}

if (!existsSync(INVENTORY)) {
  console.error(`Proxy path coverage: ${INVENTORY} is missing. Run with --write to create it.`);
  process.exit(1);
}

const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
const problems = [];

for (const pathname of pathnames) {
  const declared = inventory[pathname];
  if (!declared) {
    problems.push(
      `${pathname} has no entry in ${INVENTORY}. Decide whether it is reachable ` +
        `without a session and from outside the operator network, wire it into ` +
        `${PROXY_PATHS} accordingly, then record it.`,
    );
    continue;
  }
  // A dynamic segment is matched by pattern at runtime, so exact set membership
  // says nothing about it. The entry is still required — the point is that
  // someone decided — but its posture is not cross-checked here.
  if (pathname.includes("[")) continue;

  const actual = actualPosture(pathname, sets);
  for (const gate of ["sessionGate", "sourceIpGate"]) {
    if (declared[gate] !== actual[gate]) {
      problems.push(
        `${pathname}: inventory declares ${gate}=${declared[gate]} but ${PROXY_PATHS} ` +
          `implements ${actual[gate]}. One of the two is wrong.`,
      );
    }
  }
}

for (const pathname of Object.keys(inventory)) {
  if (!pathnames.includes(pathname)) {
    problems.push(`${pathname} is in ${INVENTORY} but no route.ts exists for it.`);
  }
}

if (problems.length) {
  console.error("Proxy path coverage check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(`Proxy path coverage check passed (${pathnames.length} API routes).`);
