import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isWithinBillingPeriod, resolveBillingPeriod } from "../lib/entitlements/billing-period.ts";

const read = (relative: string) =>
  readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("resolveBillingPeriod", () => {
  it("returns the UTC calendar month containing the instant", () => {
    const period = resolveBillingPeriod(new Date("2026-08-11T17:09:02.367Z"));
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    const period = resolveBillingPeriod(new Date("2026-12-31T23:59:59.999Z"));
    expect(period.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("puts the first instant of a month in that month, not the previous one", () => {
    const period = resolveBillingPeriod(new Date("2026-08-01T00:00:00.000Z"));
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("is half-open: the end instant belongs to the next period", () => {
    const period = resolveBillingPeriod(new Date("2026-08-15T00:00:00.000Z"));
    expect(isWithinBillingPeriod(period, period.start)).toBe(true);
    expect(isWithinBillingPeriod(period, new Date("2026-08-31T23:59:59.999Z"))).toBe(true);
    expect(isWithinBillingPeriod(period, period.end)).toBe(false);
  });

  it("does not depend on the host timezone", () => {
    // A local-time implementation would put this in July for anyone west of UTC.
    const period = resolveBillingPeriod(new Date("2026-08-01T00:30:00.000Z"));
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

// The web app and the Go worker both increment the same rows. If their period
// boundaries disagreed by so much as a timezone, each tenant's month would
// silently split across two rows and every measurement would be wrong.
describe("period boundary agreement with the Go worker", () => {
  it("computes the boundary the worker's SQL computes", async () => {
    const source = await read("../../worker/internal/worker/evidence.go");
    expect(source).toMatch(/date_trunc\('month', now\(\) AT TIME ZONE 'UTC'\) AT TIME ZONE 'UTC'/);
    expect(source).toMatch(
      /\(date_trunc\('month', now\(\) AT TIME ZONE 'UTC'\) \+ interval '1 month'\) AT TIME ZONE 'UTC'/,
    );
  });

  it("uses the same conflict target on both sides", async () => {
    const worker = await read("../../worker/internal/worker/evidence.go");
    const web = await read("../lib/repositories/usage/metering.ts");
    for (const source of [worker, web]) {
      expect(source).toMatch(/ON CONFLICT \(tenant_id, metric, period_start\)/);
    }
  });
});

// The count must be exactly-once. Both web ingest paths gate on the evidence
// dedupe key, and the increment has to sit on the branch that key protects — a
// call outside it would count replays.
describe("ingest wiring", () => {
  it("increments only inside the deduplicated insert branch", async () => {
    const source = await read("../lib/repositories/evidence/runtime.ts");
    // Both ingest paths call it, and nothing else does.
    const calls = source.match(/countIngestedEventForBilling\(tx/g) ?? [];
    expect(calls.length).toBe(2);

    // Each call must follow a chain-head advance, which itself only runs when a
    // row was actually inserted — that is the deduplicated branch.
    expect(source).toMatch(
      /UPDATE runtime_evidence_chain_head[\s\S]{0,400}?countIngestedEventForBilling\(tx/,
    );
  });

  it("increments with one statement rather than reading a count first", async () => {
    const source = await read("../lib/repositories/usage/metering.ts");
    // Strip comments so the prose explaining this rule cannot satisfy or break
    // the check on the code.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/count\(\*\)/i);
    expect(code).toMatch(/INSERT INTO tenant_usage_period[\s\S]*?ON CONFLICT/);
  });
});
