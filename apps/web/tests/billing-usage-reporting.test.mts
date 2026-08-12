import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { composeUsageIdempotencyKey } from "../lib/repositories/usage/submissions.ts";

const read = (relative: string) =>
  readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// The key is the only thing standing between a network timeout and a double
// charge, so its composition is worth pinning precisely.
describe("composeUsageIdempotencyKey", () => {
  const base = {
    tenantId: "11111111-1111-1111-1111-111111111111",
    periodStart: "2026-08-01T00:00:00.000Z",
    metric: "RETAINED_EVENTS",
    entitlementVersion: "2026-08-11.1",
  };

  it("is stable for the same submission", () => {
    expect(composeUsageIdempotencyKey(base)).toBe(composeUsageIdempotencyKey({ ...base }));
  });

  it("does not vary with time, so a retry collides with its first attempt", () => {
    const first = composeUsageIdempotencyKey(base);
    const retried = composeUsageIdempotencyKey({ ...base });
    expect(retried).toBe(first);
    expect(first).not.toMatch(/\d{13}/); // no epoch millis smuggled in
  });

  it("separates tenants, periods and metrics", () => {
    const key = composeUsageIdempotencyKey(base);
    expect(composeUsageIdempotencyKey({ ...base, tenantId: "other" })).not.toBe(key);
    expect(
      composeUsageIdempotencyKey({ ...base, periodStart: "2026-09-01T00:00:00.000Z" }),
    ).not.toBe(key);
    expect(composeUsageIdempotencyKey({ ...base, metric: "SIMULATION_EVENTS" })).not.toBe(key);
  });

  // A catalog change mid-period means the figure was measured against a
  // different capacity, which makes it a different submission rather than a
  // duplicate of the earlier one.
  it("separates entitlement versions", () => {
    expect(composeUsageIdempotencyKey({ ...base, entitlementVersion: "2026-09-01.1" })).not.toBe(
      composeUsageIdempotencyKey(base),
    );
  });

  it("still produces a key when no version was recorded", () => {
    expect(composeUsageIdempotencyKey({ ...base, entitlementVersion: null })).toContain(
      "unversioned",
    );
  });
});

describe("the billing metering slot contract", () => {
  it("does not throw on an OSS deployment", async () => {
    const source = await read("../lib/ee-adapters/billing-metering.ts");
    // Unlike archival or SCIM, nothing in an OSS deployment is waiting on a
    // usage submission, so failing loudly would be recurring noise rather than
    // a signal.
    expect(source).toMatch(/const fallbackSlot: BillingMeteringSlot = \{/);
    const fallback = source.slice(
      source.indexOf("const fallbackSlot"),
      source.indexOf("// Resilient"),
    );
    expect(fallback).not.toMatch(/throw new Error/);
    expect(fallback).toMatch(/status: "SKIPPED"/);
  });

  it("resolves the implementation dynamically, never importing ee/", async () => {
    const source = await read("../lib/ee-adapters/billing-metering.ts");
    expect(source).toMatch(/loadCommercialSlot<[\s\S]*?>\(\s*"web\/billing\/index\.js",?\s*\)/);
    expect(source).not.toMatch(/from "(\.\.\/)*ee\//);
  });
});

describe("usage reporting", () => {
  it("binds tenant context before touching the database", async () => {
    const source = await read("../lib/domains/billing/usage-reporting.ts");
    // Triggered by the worker, so there is no session to carry the tenant. An
    // unbound query is refused by row-level security.
    expect(source).toMatch(/runWithTenantContext\(tenantId, async \(\) => \{/);
  });

  it("claims the submission before calling the provider", async () => {
    const source = await read("../lib/domains/billing/usage-reporting.ts");
    const claimAt = source.indexOf("claimUsageSubmission(");
    const submitAt = source.indexOf("billingMeteringService.submitUsage(");
    expect(claimAt).toBeGreaterThan(-1);
    expect(submitAt).toBeGreaterThan(-1);
    // A crash between the two must leave a record naming what was in flight,
    // rather than no record of an attempt that may have reached the provider.
    expect(claimAt).toBeLessThan(submitAt);
  });

  it("refuses to report an unmeasured period", async () => {
    const source = await read("../lib/domains/billing/usage-reporting.ts");
    expect(source).toMatch(/period\.retainedCount === null/);
  });

  it("does not re-report a period unless the previous attempt failed", async () => {
    const source = await read("../lib/domains/billing/usage-reporting.ts");
    expect(source).toMatch(/claim\.alreadyClaimed && claim\.record\.status !== "FAILED"/);
  });
});
