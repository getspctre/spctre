import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// Every one of these numbers previously existed in the usage surface as a
// literal, disagreeing with the catalog, the pricing page, or both.
const PLAN_CAPACITY_LITERALS = [1000, 25000, 50000, 100000, 250000, 1000000, 10000000];

describe("the usage surface reads the catalog", () => {
  it("carries no plan capacity of its own", async () => {
    const source = (await read("../app/usage-billing/content.tsx"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(source).not.toMatch(/\bplanCatalog\b/);
    for (const literal of PLAN_CAPACITY_LITERALS) {
      expect(source, `capacity ${literal} is restated in the usage surface`).not.toMatch(
        new RegExp(`\\b${literal}\\b`),
      );
    }
  });

  it("renders a limit only when the product enforces one", async () => {
    const source = await read("../app/usage-billing/content.tsx");
    // A denominator drawn straight from the catalog would present a commercial
    // intention as a limit the tenant is being held to.
    expect(source).toMatch(/included:\s*enforcedEntitlementValue\(/);
    expect(source).not.toMatch(/included:\s*activePlan\.\w+\.value/);
  });

  it("prefers the reconciled measurement over a request-time count", async () => {
    const source = await read("../app/usage-billing/content.tsx");
    expect(source).toMatch(/usagePeriod\?\.retainedCount/);
    // The count survives only as the fallback for an unmeasured period.
    expect(source).toMatch(/measuredRetained \?\? usage\.retainedAuditEventCount/);
  });
});

// The check is what keeps the above true after this PR. A test that only
// asserted today's state would not.
//
// The script itself is deliberately not executed here. `oss:check` runs it as
// its own CI job, and spawning a Node subprocess inside the parallel test run
// costs a worker and contends for CPU with database-backed tests that have a
// five-second timeout. What is worth asserting from here is that the script
// remains wired into the gate — running it twice adds nothing.
describe("check-entitlement-claims", () => {
  it("runs as part of oss:check", async () => {
    const manifest = JSON.parse(await read("../../../package.json")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["oss:check"]).toContain("check-entitlement-claims.mjs");
  });
});

describe("the trial cap", () => {
  it("reads the maintained gauge but falls back to a durable count", async () => {
    const source = await read("../lib/domains/evidence/ingest-service.ts");
    expect(source).toMatch(/getMeteredRetainedCount\(tenantId\)/);
    // Treating an unseeded gauge as zero would silently disable the cap, so the
    // fallback is the part that matters.
    expect(source).toMatch(/meteredCount \?\? \(await countTotalEvidenceEvents\(tenantId\)\)/);
  });

  it("still reads its capacity from the deployment's catalog", async () => {
    const source = await read("../lib/domains/evidence/ingest-service.ts");
    expect(source).toMatch(/catalog\.plans\.HOSTED_TRIAL\.retainedEvents/);
    expect(source).not.toMatch(/totalCount >= 1000/);
    // The cap applies only where a catalog claims it. Enforcing a compiled-in
    // capacity refused ingest on deployments that had bought no plan.
    expect(source).toMatch(/resolveEntitlementCatalog\(\)/);
  });
});

describe("the soft cap", () => {
  it("notifies once per period rather than once per audit", async () => {
    const source = await read("../../worker/internal/worker/jobs_usage_reconcile.go");
    expect(source).toMatch(/m\.overCap && m\.capNotifiedAt == nil/);
    expect(source).toMatch(/SET cap_notified_at = now\(\)/);
  });

  it("records the transition without refusing ingest", async () => {
    const source = await read("../../worker/internal/worker/jobs_usage_reconcile.go");
    expect(source).toMatch(/USAGE_LIMIT_EXCEEDED/);
    // The audit measures and reports; nothing on this path rejects a request.
    expect(source).not.toMatch(/429|StatusTooManyRequests/);
  });
});
