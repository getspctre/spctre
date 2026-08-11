import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  COMMERCIAL_PLAN_CODES,
  ENTITLEMENT_CATALOG_VERSION,
  PLAN_ENTITLEMENTS,
  enforcedEntitlementValue,
  isCommercialPlanCode,
  planEntitlements,
} from "../lib/entitlements/catalog.ts";

const workerSource = () =>
  readFile(
    fileURLToPath(new URL("../../worker/internal/worker/jobs_retention.go", import.meta.url)),
    "utf8",
  );

describe("catalog shape", () => {
  it("defines every plan code", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      expect(PLAN_ENTITLEMENTS[plan], `missing entitlements for ${plan}`).toBeDefined();
    }
    expect(Object.keys(PLAN_ENTITLEMENTS).sort()).toEqual([...COMMERCIAL_PLAN_CODES].sort());
  });

  it("carries an explicit enforcement state on every entitlement", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      const entry = PLAN_ENTITLEMENTS[plan];
      for (const key of [
        "workspaces",
        "retainedEvents",
        "retentionWindowDays",
        "simulationEvents",
      ] as const) {
        expect(typeof entry[key].enforced, `${plan}.${key}.enforced`).toBe("boolean");
      }
    }
  });

  it("has a version string that provisioning can persist", () => {
    expect(ENTITLEMENT_CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("increases capacity monotonically up the plan ladder", () => {
    const ladder = ["HOSTED_TRIAL", "TEAM", "BUSINESS", "ENTERPRISE"] as const;
    for (let i = 1; i < ladder.length; i++) {
      const lower = PLAN_ENTITLEMENTS[ladder[i - 1]];
      const upper = PLAN_ENTITLEMENTS[ladder[i]];
      expect(upper.workspaces.value).toBeGreaterThan(lower.workspaces.value);
      expect(upper.retainedEvents.value).toBeGreaterThan(lower.retainedEvents.value);
      expect(upper.retentionWindowDays.value).toBeGreaterThan(lower.retentionWindowDays.value);
    }
  });
});

describe("planEntitlements", () => {
  it("falls back to the trial for absent or unrecognized plan codes", () => {
    expect(planEntitlements(null)).toBe(PLAN_ENTITLEMENTS.HOSTED_TRIAL);
    expect(planEntitlements("OSS_EVALUATION")).toBe(PLAN_ENTITLEMENTS.HOSTED_TRIAL);
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

  it("reports paid-plan retained events as unenforced until metering is active", () => {
    // These flip to `true` only after a full billing period of reconciled
    // measurement. If this assertion is updated, the published capacity claims
    // become sayable — and the downstream pricing check starts requiring them
    // to agree.
    for (const plan of ["TEAM", "BUSINESS", "ENTERPRISE"] as const) {
      expect(
        enforcedEntitlementValue(PLAN_ENTITLEMENTS[plan].retainedEvents),
        `${plan} retained events must not render as an active cap yet`,
      ).toBeNull();
    }
  });

  // The trial is the exception: its capacity has been a live hard cap on the
  // ingest path since before the catalog existed. Marking it unenforced would
  // be a lie in the opposite direction.
  it("reports the trial's retained-event cap as enforced, because ingest rejects past it", () => {
    expect(enforcedEntitlementValue(PLAN_ENTITLEMENTS.HOSTED_TRIAL.retainedEvents)).toBe(1_000);
  });

  it("reports workspaces and retention as enforced, because they are", () => {
    for (const plan of COMMERCIAL_PLAN_CODES) {
      expect(PLAN_ENTITLEMENTS[plan].workspaces.enforced).toBe(true);
      expect(PLAN_ENTITLEMENTS[plan].retentionWindowDays.enforced).toBe(true);
    }
  });
});

// The free tier's capacity was a bare literal on the ingest path. It is the
// number that decides when a trial tenant stops being able to send evidence, so
// it belongs in the catalog with everything else that defines a plan.
describe("the ingest path reads the trial cap from the catalog", () => {
  it("holds no retained-event literal of its own", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../lib/domains/evidence/ingest-service.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/totalCount >= 1000/);
    expect(source).toMatch(/PLAN_ENTITLEMENTS\.HOSTED_TRIAL\.retainedEvents/);
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

  it("skips profiles with no provisioned window rather than guessing one", async () => {
    const source = await workerSource();
    // Guessing here deletes evidence irreversibly. Both plausible defaults are
    // wrong: the trial window would destroy an Enterprise tenant's history, and
    // the longest would silently stop pruning.
    expect(source).toMatch(/tcp\.retention_window_days IS NOT NULL/);
    expect(source).toMatch(/make_interval\(days => tcp\.retention_window_days\)/);
  });
});
