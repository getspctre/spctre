#!/usr/bin/env node
/**
 * Entitlement claim check.
 *
 * The commercial entitlement catalog records, per plan, both a value and
 * whether the product actually measures and applies it. A value marked
 * `enforced: false` is a commercial intention; presenting it as a live limit
 * tells a tenant they are being held to something nothing enforces.
 *
 * That distinction only holds if presentation surfaces read it, so this check
 * enforces three rules:
 *
 *   1. A surface that renders a capacity must obtain it through
 *      `enforcedEntitlementValue`, which yields null for an unenforced entry,
 *      rather than reaching for `.value` directly.
 *
 *   2. No surface may carry its own copy of a plan capacity as a literal. Every
 *      such literal previously drifted from every other statement of the same
 *      number.
 *
 *   3. The OSS catalog holds no capacity and enforces nothing. A paid plan's
 *      numbers reaching this repository is not a documentation slip: it is a
 *      deployment that bought nothing being held to a limit somebody else
 *      priced. That is how the hosted trial's 1,000-event cap and 90-day
 *      retention window came to bind self-hosted installs — the numbers were
 *      compiled in, and every tenant defaults to the trial plan code.
 *
 * This is deliberately narrow. It knows nothing about prices — upstream does
 * not publish them — and only inspects the catalog and the files that render
 * usage to a user.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Surfaces that present usage or capacity to a user. */
const PRESENTATION_SURFACES = ["apps/web/app/usage-billing/content.tsx"];

const CATALOG = "apps/web/lib/entitlements/catalog.ts";

/**
 * Capacity magnitudes from the catalog. A presentation surface repeating one of
 * these as a literal is almost certainly restating a plan limit rather than
 * computing something.
 */
const CAPACITY_LITERALS = [1_000, 10_000, 25_000, 50_000, 100_000, 250_000, 1_000_000, 10_000_000];

/** Retention windows in days, which had their own set of scattered copies. */
const RETENTION_LITERALS = [90, 365, 1095, 2555];

const failures = [];

async function read(relative) {
  return readFile(path.join(ROOT, relative), "utf8");
}

/** Strip comments so prose describing a rule cannot trip the check on the code. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function numericLiterals(source) {
  const found = new Set();
  for (const match of source.matchAll(/\b\d[\d_]*\b/g)) {
    const value = Number(match[0].replaceAll("_", ""));
    if (Number.isFinite(value)) found.add(value);
  }
  return found;
}

const catalogSource = await read(CATALOG);

// The catalog defines the enforcement contract, and must keep doing so.
if (!/enforced:\s*(true|false)/.test(catalogSource)) {
  failures.push(`${CATALOG}: entitlements no longer carry an explicit \`enforced\` flag.`);
}
if (!/export function enforcedEntitlementValue/.test(catalogSource)) {
  failures.push(`${CATALOG}: enforcedEntitlementValue is missing; surfaces have no safe accessor.`);
}

// Rule 3. Anything a commercial deployment sells lives in its own catalog slot,
// so nothing here may carry a capacity or a window, and nothing here may claim
// to enforce one.
{
  const source = stripComments(catalogSource);
  const literals = numericLiterals(source);
  const restated = [...CAPACITY_LITERALS, ...RETENTION_LITERALS].filter((value) =>
    literals.has(value),
  );
  if (restated.length > 0) {
    failures.push(
      `${CATALOG}: carries plan capacities (${restated.join(", ")}). A capacity belongs to the ` +
        `deployment that sells it, supplied through the entitlement-catalog slot.`,
    );
  }
  if (/enforced:\s*true/.test(source)) {
    failures.push(
      `${CATALOG}: marks an entitlement enforced. The catalog shipped here binds deployments ` +
        `that bought no plan, so every entry must be unenforced.`,
    );
  }
}

for (const surface of PRESENTATION_SURFACES) {
  const raw = await read(surface);
  const source = stripComments(raw);

  if (!source.includes("enforcedEntitlementValue")) {
    failures.push(
      `${surface}: renders usage but never calls enforcedEntitlementValue. A capacity read ` +
        `straight from the catalog presents unenforced intentions as active limits.`,
    );
  }

  // `.value` is legitimate for comparison and for the reference plan shown
  // alongside the tenant's own; it is only a problem when it feeds `included`,
  // which is what the meter renders as the denominator of a limit.
  //
  // Matched with a trailing comma so this inspects object-literal properties
  // and not the semicolon-terminated field in the interface declaration.
  for (const match of source.matchAll(/included:\s*([^,\n]+),/g)) {
    const expression = match[1].trim();
    const safe =
      expression.startsWith("enforcedEntitlementValue(") ||
      expression === "null" ||
      /^row\./.test(expression);
    if (!safe) {
      failures.push(
        `${surface}: \`included: ${expression}\` does not go through enforcedEntitlementValue, ` +
          `so an unenforced capacity would render as a limit.`,
      );
    }
  }

  const literals = numericLiterals(source);
  const restated = [...CAPACITY_LITERALS, ...RETENTION_LITERALS].filter((value) =>
    literals.has(value),
  );
  if (restated.length > 0) {
    failures.push(
      `${surface}: restates plan capacities as literals (${restated.join(", ")}). ` +
        `Read them from ${CATALOG} instead.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Entitlement claim check failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nA number the product does not enforce must not be presented as a limit. See " +
      "the enforcement-state contract in the catalog.",
  );
  process.exit(1);
}

console.log(
  `Entitlement claim check passed (${PRESENTATION_SURFACES.length} presentation surface(s)).`,
);
