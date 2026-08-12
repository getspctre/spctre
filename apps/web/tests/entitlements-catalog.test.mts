import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  COMMERCIAL_PLAN_CODES,
  OSS_ENTITLEMENT_CATALOG,
  OSS_ENTITLEMENT_CATALOG_VERSION,
  enforcedEntitlementValue,
  isCommercialPlanCode,
  planEntitlements,
} from "../lib/entitlements/catalog.ts";

const read = (relative: string) =>
  readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const workerSource = () => read("../../worker/internal/worker/jobs_retention.go");

const ENTITLEMENT_KEYS = [
  "workspaces",
  "retainedEvents",
  "retentionWindowDays",
  "simulationEvents",
] as const;

describe("catalog shape", () => {
  it("defines every plan code", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      expect(OSS_ENTITLEMENT_CATALOG.plans[plan], `missing entitlements for ${plan}`).toBeDefined();
    }
    expect(Object.keys(OSS_ENTITLEMENT_CATALOG.plans).sort()).toEqual(
      [...COMMERCIAL_PLAN_CODES].sort(),
    );
  });

  it("carries an explicit enforcement state on every entitlement", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      const entry = OSS_ENTITLEMENT_CATALOG.plans[plan];
      for (const key of ENTITLEMENT_KEYS) {
        expect(typeof entry[key].enforced, `${plan}.${key}.enforced`).toBe("boolean");
      }
    }
  });

  it("has a version string that provisioning can persist", () => {
    expect(OSS_ENTITLEMENT_CATALOG.version).toBe(OSS_ENTITLEMENT_CATALOG_VERSION);
    expect(OSS_ENTITLEMENT_CATALOG.version.length).toBeGreaterThan(0);
  });
});

// The regression this file exists for. A deployment that bought nothing must
// not be held to anything: the hosted trial's capacity previously shipped as an
// enforced number, every tenant defaults to the trial plan code, and the result
// was a self-hosted install that refused ingest at 1,000 events and pruned its
// own evidence after 90 days.
describe("the catalog shipped in OSS binds nobody", () => {
  it("claims no capacity on any plan", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      const entry = OSS_ENTITLEMENT_CATALOG.plans[plan];
      for (const key of ENTITLEMENT_KEYS) {
        expect(entry[key].value, `${plan}.${key} must be unlimited here`).toBeNull();
      }
    }
  });

  it("enforces nothing on any plan", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      const entry = OSS_ENTITLEMENT_CATALOG.plans[plan];
      for (const key of ENTITLEMENT_KEYS) {
        expect(entry[key].enforced, `${plan}.${key} must not be enforced here`).toBe(false);
        expect(enforcedEntitlementValue(entry[key])).toBeNull();
      }
    }
  });

  it("still names the plans, which are public either way", () => {
    expect(OSS_ENTITLEMENT_CATALOG.plans.BUSINESS.displayName).toBe("Business");
  });
});

describe("planEntitlements", () => {
  it("falls back to the trial for absent or unrecognized plan codes", () => {
    expect(planEntitlements(OSS_ENTITLEMENT_CATALOG, null)).toBe(
      OSS_ENTITLEMENT_CATALOG.plans.HOSTED_TRIAL,
    );
    expect(planEntitlements(OSS_ENTITLEMENT_CATALOG, "OSS_EVALUATION")).toBe(
      OSS_ENTITLEMENT_CATALOG.plans.HOSTED_TRIAL,
    );
  });

  it("narrows known plan codes", () => {
    expect(isCommercialPlanCode("BUSINESS")).toBe(true);
    expect(isCommercialPlanCode("OSS_EVALUATION")).toBe(false);
    expect(isCommercialPlanCode(undefined)).toBe(false);
  });
});

// The point of the enforcement flag: a value nothing measures must not reach a
// surface that presents it as a live limit.
describe("enforcedEntitlementValue", () => {
  it("returns the value only when the product enforces it", () => {
    expect(enforcedEntitlementValue({ value: 3, enforced: true })).toBe(3);
    expect(enforcedEntitlementValue({ value: 100_000, enforced: false })).toBeNull();
  });

  it("treats an unlimited entitlement as no limit even when enforced", () => {
    expect(enforcedEntitlementValue({ value: null, enforced: true })).toBeNull();
  });
});

// The free tier's capacity was a bare literal on the ingest path, then a
// compiled-in constant. Both decided when a tenant stops being able to send
// evidence without asking whether this deployment sells a tier at all.
describe("the ingest path reads the trial cap from the resolved catalog", () => {
  it("holds no retained-event literal, and no compiled-in catalog", async () => {
    const source = await read("../lib/domains/evidence/ingest-service.ts");
    expect(source).not.toMatch(/totalCount >= 1000/);
    expect(source).not.toMatch(/PLAN_ENTITLEMENTS/);
    expect(source).toMatch(/catalog\.plans\.HOSTED_TRIAL\.retainedEvents/);
    expect(source).toMatch(/resolveEntitlementCatalog/);
  });
});

describe("the entitlement catalog slot", () => {
  it("falls back to the unmetered catalog rather than throwing", async () => {
    const source = await read("../lib/ee-adapters/entitlement-catalog.ts");
    // An OSS deployment is the normal case for this slot, not a caller reaching
    // for a premium capability, so a missing implementation is not an error.
    expect(source).toMatch(/fallbackSlot/);
    expect(source).not.toMatch(/throw new Error/);
  });

  it("degrades a malformed commercial catalog to unmetered, not to zero", async () => {
    const source = await read("../lib/ee-adapters/entitlement-catalog.ts");
    // A partly populated catalog would read as a zero capacity on the missing
    // plan and refuse a paying tenant's ingest.
    expect(source).toMatch(/isWellFormed/);
  });
});

describe("the retention worker reads the provisioned window", () => {
  it("no longer re-derives the window from plan_code", async () => {
    const source = await workerSource();
    expect(
      source,
      "jobs_retention.go still derives the retention window from plan_code; the catalog is meant to be the only source",
    ).not.toMatch(/CASE tcp\.plan_code/);
  });

  it("prunes from the provisioned column", async () => {
    const source = await workerSource();
    expect(source).toMatch(/make_interval\(days => tcp\.retention_window_days\)/);
  });

  // Migration 019 made the window NOT NULL because every deployment provisioned
  // one from a compiled-in catalog. Now a deployment with no commercial catalog
  // provisions none, and NULL is what "retain indefinitely" looks like in the
  // column the sweep reads. If the constraint comes back, a self-hosted install
  // starts pruning again on somebody else's schedule.
  it("allows an unprovisioned window, so nothing is pruned by default", async () => {
    const migration = await read("../../../db/migrations/022_unmetered_entitlements.sql");
    expect(migration).toMatch(/ALTER COLUMN retention_window_days DROP NOT NULL/);
    expect(migration).toMatch(/ALTER COLUMN retained_event_capacity DROP NOT NULL/);
    expect(migration).toMatch(/retained_event_capacity IS NULL OR retained_event_capacity > 0/);
  });
});
