import { describe, expect, it } from "vitest";
import { OSS_ENTITLEMENT_CATALOG, type EntitlementCatalog } from "../lib/entitlements/catalog.ts";
import {
  describeRetentionWindow,
  resolveRetainUntil,
  resolveRetentionWindowDays,
  type CommercialPlanCode,
} from "../lib/entitlements/retention.ts";

const PLAN_CODES: CommercialPlanCode[] = ["HOSTED_TRIAL", "TEAM", "BUSINESS", "ENTERPRISE"];

/**
 * A stand-in for a commercial catalog. The real windows are supplied by the
 * deployment that sells them, so these tests state their own rather than
 * asserting numbers this repository is no longer entitled to hold.
 */
const metered: EntitlementCatalog = {
  version: "test.1",
  plans: {
    HOSTED_TRIAL: {
      displayName: "Hosted Trial",
      workspaces: { value: 1, enforced: true },
      retainedEvents: { value: 1_000, enforced: true },
      retentionWindowDays: { value: 90, enforced: true },
      simulationEvents: { value: null, enforced: false },
    },
    TEAM: {
      displayName: "Team",
      workspaces: { value: 3, enforced: true },
      retainedEvents: { value: 100_000, enforced: false },
      retentionWindowDays: { value: 365, enforced: true },
      simulationEvents: { value: null, enforced: false },
    },
    BUSINESS: {
      displayName: "Business",
      workspaces: { value: 12, enforced: true },
      retainedEvents: { value: 1_000_000, enforced: false },
      retentionWindowDays: { value: 1095, enforced: true },
      simulationEvents: { value: 50_000, enforced: false },
    },
    ENTERPRISE: {
      displayName: "Enterprise",
      workspaces: { value: 50, enforced: true },
      retainedEvents: { value: 10_000_000, enforced: false },
      retentionWindowDays: { value: 2555, enforced: true },
      simulationEvents: { value: 1_000_000, enforced: false },
    },
  },
};

describe("resolveRetentionWindowDays", () => {
  it("returns the catalog's default for every plan", () => {
    expect(resolveRetentionWindowDays({ planCode: "HOSTED_TRIAL" }, metered)).toBe(90);
    expect(resolveRetentionWindowDays({ planCode: "TEAM" }, metered)).toBe(365);
    expect(resolveRetentionWindowDays({ planCode: "BUSINESS" }, metered)).toBe(1095);
    expect(resolveRetentionWindowDays({ planCode: "ENTERPRISE" }, metered)).toBe(2555);
  });

  // The bug this module exists to fix: the archival and compliance call sites
  // consulted retention_window_days for ENTERPRISE only, so a negotiated window
  // on any other plan was honoured by the pruning worker but ignored when
  // deciding how long to archive for.
  it("lets an explicit window override the plan default on every plan", () => {
    for (const planCode of PLAN_CODES) {
      expect(resolveRetentionWindowDays({ planCode, retentionWindowDays: 730 }, metered)).toBe(730);
    }
  });

  it("treats a non-positive or non-finite stored window as unset", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveRetentionWindowDays({ planCode: "TEAM", retentionWindowDays: invalid }, metered),
      ).toBe(365);
    }
  });

  it("falls back to the trial when the plan code is missing or unrecognized", () => {
    const trial = metered.plans.HOSTED_TRIAL.retentionWindowDays.value;
    expect(resolveRetentionWindowDays(null, metered)).toBe(trial);
    expect(resolveRetentionWindowDays({}, metered)).toBe(trial);
    expect(resolveRetentionWindowDays({ planCode: "OSS_EVALUATION" }, metered)).toBe(trial);
  });
});

// Where a self-hosted install used to inherit the hosted trial's 90 days and
// prune its own evidence on it.
describe("with no commercial catalog", () => {
  it("gives every plan an indefinite window", () => {
    for (const planCode of PLAN_CODES) {
      expect(resolveRetentionWindowDays({ planCode }, OSS_ENTITLEMENT_CATALOG)).toBeNull();
    }
    expect(resolveRetentionWindowDays(null, OSS_ENTITLEMENT_CATALOG)).toBeNull();
  });

  it("still honours a window an operator set explicitly", () => {
    expect(
      resolveRetentionWindowDays(
        { planCode: "TEAM", retentionWindowDays: 30 },
        OSS_ENTITLEMENT_CATALOG,
      ),
    ).toBe(30);
  });

  it("gives archived evidence no expiry", () => {
    expect(resolveRetainUntil({ planCode: "TEAM" }, OSS_ENTITLEMENT_CATALOG)).toBeNull();
  });
});

describe("resolveRetainUntil", () => {
  it("offsets from the supplied instant by the effective window", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(resolveRetainUntil({ planCode: "TEAM" }, metered, from)?.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(
      resolveRetainUntil(
        { planCode: "TEAM", retentionWindowDays: 1 },
        metered,
        from,
      )?.toISOString(),
    ).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("describeRetentionWindow", () => {
  it("reports the effective day count", () => {
    expect(describeRetentionWindow({ planCode: "BUSINESS" }, metered)).toBe(
      "Business 1095-day retention limit",
    );
    expect(describeRetentionWindow({ planCode: "TEAM", retentionWindowDays: 730 }, metered)).toBe(
      "Team 730-day retention limit",
    );
  });

  it("falls back to trial copy for an unrecognized plan", () => {
    expect(describeRetentionWindow({ planCode: "OSS_EVALUATION" }, metered)).toBe(
      "Hosted Trial 90-day retention limit",
    );
  });

  it("says so plainly when nothing expires", () => {
    expect(describeRetentionWindow({ planCode: "TEAM" }, OSS_ENTITLEMENT_CATALOG)).toBe(
      "Team — evidence retained indefinitely",
    );
  });
});
