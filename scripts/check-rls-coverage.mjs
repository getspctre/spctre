import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Every tenant-bearing table the application role can reach must be behind a
// row-level security policy.
//
// Tenant isolation in this codebase has two layers: the repositories pass a
// tenant_id, and RLS enforces it on the connection. The first layer alone fails
// silently — a missed WHERE clause returns another tenant's rows and looks like
// a working query. Ten tables shipped with a GRANT to spctre_app and no policy
// because nothing checked, so this asserts the relationship instead of leaving
// it to reviewers to notice.
//
// A table qualifies if it declares a tenant_id column and is granted to
// spctre_app. Partitions are exempt, but only because the check verifies their
// parent carries a policy — the exemption is asserted, not assumed. That
// matters most for the partitions nothing here can see: the monthly evidence
// partition is built from a plpgsql format() string, so its columns never
// appear in a CREATE TABLE this script can parse. Dynamic statements are
// therefore read for what they create, and one that is not a partition is
// rejected rather than passing unseen.

const MIGRATIONS_DIR = "db/migrations";

// Tables that legitimately carry a tenant_id with no policy. Each entry needs a
// reason, and the reason has to be about when the row is written, not about how
// sensitive it is.
const EXCLUSIONS = new Map([
  [
    "webauthn_challenge",
    "Written before any session exists, on the owner connection. tenant_id is " +
      "nullable because usernameless login has no tenant at the start step, so " +
      "a tenant_isolation policy would reject the rows login depends on. " +
      "Protected by one-time consumption and a short TTL.",
  ],
  [
    "saml_authn_request",
    "Written at SSO initiation and read in the callback, both before a session " +
      "exists, on the owner connection. Protected by one-time consumption and a " +
      "short TTL.",
  ],
]);

const sql = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

const tenantTables = new Set();
// partition name -> the parent it belongs to. A partition is exempt only
// because its parent is checked, so the parent has to be recorded, not assumed.
const partitions = new Map();
for (const match of sql.matchAll(
  /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)\s*(\(([\s\S]*?)\n\);|PARTITION OF (?:public\.)?(\w+))/g,
)) {
  const [, table, form, body, partitionParent] = match;
  if (form.startsWith("PARTITION OF")) {
    partitions.set(table, partitionParent);
    continue;
  }
  if (/^\s*tenant_id\b/m.test(body)) tenantTables.add(table);
}

// The dumped baseline declares partitions as standalone tables and attaches
// them afterwards, so the CREATE TABLE form above does not identify them.
for (const match of sql.matchAll(
  /ALTER TABLE (?:ONLY )?(?:public\.)?(\w+) ATTACH PARTITION (?:public\.)?(\w+)/g,
)) {
  partitions.set(match[2], match[1]);
}

// Tables created from a plpgsql format() string are invisible to the CREATE
// TABLE scan above — spctre_ensure_runtime_evidence_partitions builds a new
// evidence partition every month that way. Partitions are exempt from the RLS
// requirement because the parent carries it, so a dynamic statement that
// creates anything *other* than a partition would slip past this check
// entirely. Collect the dynamic parents, and reject any dynamic CREATE TABLE
// that is not a partition rather than letting it pass unseen.
const dynamicPartitionParents = new Set();
const dynamicCreates = [];
// Only literals that *open* with the statement, so ordinary quoted values in
// the dumped baseline ('CUSTOM'::text and friends) are not mistaken for one.
for (const match of sql.matchAll(/'(\s*create table\b[^']*)'/gi)) {
  const statement = match[1].replace(/\s+/g, " ");
  const partitionOf = statement.match(/partition of (?:public\.)?(\w+)/i);
  if (partitionOf) {
    dynamicPartitionParents.add(partitionOf[1]);
  } else {
    dynamicCreates.push(statement.trim());
  }
}

const rlsEnabled = new Set(
  [...sql.matchAll(/ALTER TABLE (?:ONLY )?(?:public\.)?(\w+) ENABLE ROW LEVEL SECURITY/g)].map(
    (match) => match[1],
  ),
);
const hasPolicy = new Set(
  [...sql.matchAll(/CREATE POLICY \w+ ON (?:public\.)?(\w+)/g)].map((match) => match[1]),
);
const grantedToApp = new Set(
  [...sql.matchAll(/GRANT [^;]*? ON (?:TABLE )?(?:public\.)?(\w+) TO ([\w, ]+);/g)]
    .filter((match) => match[2].split(",").some((role) => role.trim() === "spctre_app"))
    .map((match) => match[1]),
);

const violations = [];

// The partition exemption is only sound while every partition hangs off a
// parent that is itself behind a policy. Assert that rather than assuming it,
// for the static partitions and for the ones built by format() alike.
for (const [partition, parent] of partitions) {
  if (!rlsEnabled.has(parent) || !hasPolicy.has(parent)) {
    violations.push(
      `${partition}: exempted as a partition of ${parent}, which has no tenant_isolation policy`,
    );
  }
}
for (const parent of dynamicPartitionParents) {
  if (!rlsEnabled.has(parent) || !hasPolicy.has(parent)) {
    violations.push(
      `${parent}: partitions are created dynamically for it, but it has no tenant_isolation policy`,
    );
  }
}
for (const statement of dynamicCreates) {
  violations.push(
    `dynamic CREATE TABLE that is not a partition, so this check cannot see its columns: ${statement}`,
  );
}

for (const table of [...tenantTables].sort()) {
  if (partitions.has(table) || !grantedToApp.has(table)) continue;
  if (EXCLUSIONS.has(table)) continue;
  if (!rlsEnabled.has(table)) {
    violations.push(`${table}: granted to spctre_app with a tenant_id but no RLS enabled`);
  } else if (!hasPolicy.has(table)) {
    // RLS without a policy denies every row to the app role, which reads as an
    // empty result rather than an error.
    violations.push(`${table}: RLS enabled with no policy; the app role sees no rows`);
  }
}

// A stale exclusion is worse than none: it silently keeps a table out of the
// check after the reason for excluding it has gone.
for (const table of EXCLUSIONS.keys()) {
  if (!tenantTables.has(table)) {
    violations.push(`${table}: listed as an RLS exclusion but no such tenant-bearing table exists`);
  } else if (hasPolicy.has(table)) {
    violations.push(`${table}: has a tenant_isolation policy; remove it from EXCLUSIONS`);
  }
}

if (violations.length > 0) {
  console.error("RLS coverage check failed:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(
    "\nAdd `ENABLE ROW LEVEL SECURITY` and a tenant_isolation policy in a new migration, " +
      "or add the table to EXCLUSIONS in this script with the reason it is written " +
      "without a tenant context.",
  );
  process.exit(1);
}

console.log(
  `RLS coverage check passed (${tenantTables.size} tenant-bearing tables, ${EXCLUSIONS.size} documented exclusion(s)).`,
);
