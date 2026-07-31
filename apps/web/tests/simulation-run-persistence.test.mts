import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSimulationRun } from "@spctre/policy-schema";

const { ensureDemoTenantSpy, jsonSpy, sqlTag, txTag } = vi.hoisted(() => {
  const jsonSpy = vi.fn((value: unknown) => ({ json: value }));
  const txTag = Object.assign(
    vi.fn(async (strings: TemplateStringsArray) => (
      strings.join("").includes("INSERT INTO simulation_run")
        ? [{ id: "50000000-0000-4000-8000-000000000001" }]
        : []
    )),
    { json: jsonSpy }
  );
  const sqlTag = Object.assign(
    vi.fn(),
    { begin: vi.fn(async (callback: (tx: typeof txTag) => Promise<unknown>) => callback(txTag)) }
  );
  return { ensureDemoTenantSpy: vi.fn(async () => undefined), jsonSpy, sqlTag, txTag };
});

vi.mock("@/lib/db", () => ({ sql: sqlTag }));
vi.mock("@/lib/repositories/seed/local-dev", () => ({ ensureDemoTenant: ensureDemoTenantSpy }));

const { persistSimulationRun } = await import("../lib/repositories/evidence/simulation");

describe("simulation run persistence", () => {
  beforeEach(() => {
    ensureDemoTenantSpy.mockClear();
    jsonSpy.mockClear();
    sqlTag.begin.mockClear();
    txTag.mockClear();
  });

  it("passes replay findings to jsonb_to_recordset as a JSON array", async () => {
    const run = buildSimulationRun({
      id: "sim-test",
      branchId: "10000000-0000-4000-8000-000000000001",
      revisionId: "20000000-0000-4000-8000-000000000001",
      sourceEventCount: 1,
      createdBy: "tester",
      createdAt: "2026-07-31T00:00:00.000Z",
      results: [{
        eventId: "decision-1",
        connector: "github",
        action: "repo.read",
        previousStatus: "ALLOW",
        proposedStatus: "ALLOW",
        delta: "UNCHANGED",
        matchedPolicyRefs: [],
        reason: "Allowed.",
      }],
      regressionSummary: {
        coverage: "RETAINED_LOG",
        newlyDeniedExpectedWorkCount: 0,
        removedEscalationCoverageCount: 0,
        newlyAllowedHighRiskCount: 0,
        blockingCount: 0,
      },
    });

    await expect(persistSimulationRun(
      run,
      "30000000-0000-4000-8000-000000000001",
      "40000000-0000-4000-8000-000000000001"
    )).resolves.toBe("50000000-0000-4000-8000-000000000001");

    expect(jsonSpy).toHaveBeenCalledWith([expect.objectContaining({ event_id: "decision-1" })]);
    const findingInsert = txTag.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join("").includes("jsonb_to_recordset")
    );
    expect(findingInsert).toBeDefined();
    expect(findingInsert?.slice(1)).toContainEqual({
      json: [expect.objectContaining({ event_id: "decision-1" })],
    });
  });
});
