import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_RETENTION_WINDOW_DAYS,
  PLAN_RETENTION_WINDOW_DAYS,
  describeRetentionWindow,
  resolveRetainUntil,
  resolveRetentionWindowDays,
  type CommercialPlanCode,
} from "../lib/entitlements/retention.ts";

const PLAN_CODES: CommercialPlanCode[] = ["HOSTED_TRIAL", "TEAM", "BUSINESS", "ENTERPRISE"];

describe("resolveRetentionWindowDays", () => {
  it("returns the documented default for every plan", () => {
    expect(resolveRetentionWindowDays({ planCode: "HOSTED_TRIAL" })).toBe(90);
    expect(resolveRetentionWindowDays({ planCode: "TEAM" })).toBe(365);
    expect(resolveRetentionWindowDays({ planCode: "BUSINESS" })).toBe(1095);
    expect(resolveRetentionWindowDays({ planCode: "ENTERPRISE" })).toBe(2555);
  });

  // The bug this module exists to fix: the archival and compliance call sites
  // consulted retention_window_days for ENTERPRISE only, so a negotiated window
  // on any other plan was honoured by the pruning worker but ignored when
  // deciding how long to archive for.
  it("lets an explicit window override the plan default on every plan", () => {
    for (const planCode of PLAN_CODES) {
      expect(resolveRetentionWindowDays({ planCode, retentionWindowDays: 730 })).toBe(730);
    }
  });

  it("treats a non-positive or non-finite stored window as unset", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveRetentionWindowDays({ planCode: "TEAM", retentionWindowDays: invalid })).toBe(
        365,
      );
    }
  });

  it("falls back when the plan code is missing or unrecognized", () => {
    expect(resolveRetentionWindowDays(null)).toBe(FALLBACK_RETENTION_WINDOW_DAYS);
    expect(resolveRetentionWindowDays({})).toBe(FALLBACK_RETENTION_WINDOW_DAYS);
    expect(resolveRetentionWindowDays({ planCode: "OSS_EVALUATION" })).toBe(
      FALLBACK_RETENTION_WINDOW_DAYS,
    );
  });
});

describe("resolveRetainUntil", () => {
  it("offsets from the supplied instant by the effective window", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(resolveRetainUntil({ planCode: "TEAM" }, from).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(
      resolveRetainUntil({ planCode: "TEAM", retentionWindowDays: 1 }, from).toISOString(),
    ).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("describeRetentionWindow", () => {
  it("names the plan limit when the window is the plan default", () => {
    expect(describeRetentionWindow({ planCode: "BUSINESS" })).toBe(
      "Business 3-year retention limit",
    );
  });

  it("reports the effective day count when a tenant overrides the default", () => {
    expect(describeRetentionWindow({ planCode: "TEAM", retentionWindowDays: 730 })).toBe(
      "Team 730-day retention limit",
    );
  });

  // Enterprise windows are negotiated, so the duration is shown even at the
  // default. This preserves the string the compliance surface rendered before
  // the derivation was centralized.
  it("always shows the day count for Enterprise", () => {
    expect(describeRetentionWindow({ planCode: "ENTERPRISE" })).toBe(
      "Enterprise 2555-day retention limit",
    );
    expect(describeRetentionWindow({ planCode: "ENTERPRISE", retentionWindowDays: 3650 })).toBe(
      "Enterprise 3650-day retention limit",
    );
  });

  it("falls back to trial copy for an unrecognized plan", () => {
    expect(describeRetentionWindow({ planCode: "OSS_EVALUATION" })).toBe(
      "Hosted Trial 90-day retention limit",
    );
  });
});

// The retention worker prunes; this module decides how long to archive and what
// compliance reports claim. If the two disagree a tenant's evidence is deleted
// on one schedule and retained on another, which is exactly the state this
// change repaired. Parse the worker's SQL so drift fails here rather than in
// production.
describe("parity with the retention worker", () => {
  it("matches the plan defaults in jobs_retention.go", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../../worker/internal/worker/jobs_retention.go", import.meta.url)),
      "utf8",
    );

    const caseBlock = source.match(/CASE tcp\.plan_code([\s\S]*?)END/);
    expect(caseBlock, "plan_code CASE block not found in jobs_retention.go").not.toBeNull();

    const workerDefaults = new Map<string, number>();
    for (const [, plan, days] of caseBlock![1].matchAll(/WHEN '([A-Z_]+)' THEN (\d+)/g)) {
      workerDefaults.set(plan, Number(days));
    }

    expect(Object.fromEntries(workerDefaults)).toEqual(PLAN_RETENTION_WINDOW_DAYS);

    const elseDays = caseBlock![1].match(/ELSE (\d+)/);
    expect(elseDays, "CASE has no ELSE branch").not.toBeNull();
    expect(Number(elseDays![1])).toBe(FALLBACK_RETENTION_WINDOW_DAYS);
  });

  it("agrees that an explicit window overrides the plan default", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../../worker/internal/worker/jobs_retention.go", import.meta.url)),
      "utf8",
    );
    // COALESCE(retention_window_days, CASE ...) is what makes the override win
    // for every plan. resolveRetentionWindowDays mirrors precisely this.
    expect(source).toMatch(/COALESCE\(\s*tcp\.retention_window_days,\s*CASE tcp\.plan_code/);
  });
});
