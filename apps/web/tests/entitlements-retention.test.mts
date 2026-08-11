import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "../lib/entitlements/catalog.ts";
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

// This module and the catalog must stay in step: the plan defaults exposed here
// are what provisioning materializes onto the profile, and the retention worker
// prunes from that materialized value.
//
// The worker previously carried its own copy of the plan defaults and a test
// here parsed them to keep the two aligned. It no longer derives anything —
// `entitlements-catalog.test.mts` asserts that, which is a stronger guarantee
// than parity between two implementations.
describe("catalog alignment", () => {
  it("exposes the catalog's retention windows", () => {
    expect(PLAN_RETENTION_WINDOW_DAYS).toEqual({
      HOSTED_TRIAL: PLAN_ENTITLEMENTS.HOSTED_TRIAL.retentionWindowDays.value,
      TEAM: PLAN_ENTITLEMENTS.TEAM.retentionWindowDays.value,
      BUSINESS: PLAN_ENTITLEMENTS.BUSINESS.retentionWindowDays.value,
      ENTERPRISE: PLAN_ENTITLEMENTS.ENTERPRISE.retentionWindowDays.value,
    });
    expect(FALLBACK_RETENTION_WINDOW_DAYS).toBe(
      PLAN_ENTITLEMENTS.HOSTED_TRIAL.retentionWindowDays.value,
    );
  });
});
