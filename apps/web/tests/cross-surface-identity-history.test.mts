import { describe, expect, it } from "vitest";
import { buildCrossSurfaceIdentityHistory } from "@spctre/policy-schema";
import type { AgentSurfaceBinding, CrossSurfaceIdentityEvent } from "@spctre/policy-schema";

const surfaces: AgentSurfaceBinding[] = [
  {
    id: "binding-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    canonicalAgentId: "agent-canonical",
    surfaceType: "notion-worker",
    surfaceAgentId: "agent-notion",
    createdBy: "admin-1",
    createdAt: "2026-07-18T00:00:00.000Z",
  },
];

const events: CrossSurfaceIdentityEvent[] = [
  {
    kind: "DECISION",
    at: "2026-07-19T10:00:00.000Z",
    surfaceAgentId: "agent-canonical",
    summary: "ALLOW on stripe.refund",
    status: "ALLOW",
    connector: "stripe",
    action: "refund",
    ref: "dec-1",
  },
  {
    kind: "DECISION",
    at: "2026-07-19T09:00:00.000Z",
    surfaceAgentId: "agent-notion",
    surfaceType: "notion-worker",
    summary: "DENY on notion.export",
    status: "DENY",
    ref: "dec-2",
  },
  {
    kind: "TRUST",
    at: "2026-07-19T11:00:00.000Z",
    surfaceAgentId: "agent-notion",
    surfaceType: "notion-worker",
    summary: "Trust 0.82 (-0.05)",
    status: "EVIDENCE_INGEST",
    ref: "trust-1",
    detail: { trustScore: 0.82, delta: -0.05 },
  },
  {
    kind: "REVIEW",
    at: "2026-07-19T12:00:00.000Z",
    surfaceAgentId: "agent-canonical",
    summary: "Reviewer ABORT on stripe.refund",
    status: "ABORT",
    ref: "dec-1",
  },
  {
    kind: "IDENTITY",
    at: "2026-07-18T00:00:00.000Z",
    surfaceAgentId: "agent-canonical",
    summary: "surface linked",
    status: "SURFACE_LINKED",
    ref: "id-1",
  },
];

describe("buildCrossSurfaceIdentityHistory", () => {
  it("merges events newest-first and preserves surface provenance", () => {
    const history = buildCrossSurfaceIdentityHistory({
      canonicalAgentId: "agent-canonical",
      surfaces,
      events,
    });
    expect(history.events.map((event) => event.ref)).toEqual([
      "dec-1",
      "trust-1",
      "dec-1",
      "dec-2",
      "id-1",
    ]);
    // The reviewer resolution (dec-1) sorts ahead of the decision it resolved.
    expect(history.events[0]).toMatchObject({ kind: "REVIEW", ref: "dec-1" });
    expect(history.events.find((event) => event.ref === "dec-2")?.surfaceType).toBe(
      "notion-worker",
    );
  });

  it("derives per-kind counts, surface count, and latest trust score", () => {
    const history = buildCrossSurfaceIdentityHistory({
      canonicalAgentId: "agent-canonical",
      surfaces,
      events,
    });
    expect(history.counts).toEqual({ decisions: 2, trust: 1, identity: 1, reviews: 1 });
    expect(history.surfaceCount).toBe(1);
    expect(history.latestTrustScore).toBe(0.82);
  });

  it("applies the limit after sorting so the newest events survive", () => {
    const history = buildCrossSurfaceIdentityHistory({
      canonicalAgentId: "agent-canonical",
      surfaces,
      events,
      limit: 2,
    });
    expect(history.events).toHaveLength(2);
    expect(history.events.map((event) => event.ref)).toEqual(["dec-1", "trust-1"]);
    // Counts reflect only the retained window, not the full input.
    expect(history.counts).toEqual({ decisions: 0, trust: 1, identity: 0, reviews: 1 });
  });

  it("returns a stable empty shape when there is no history", () => {
    const history = buildCrossSurfaceIdentityHistory({
      canonicalAgentId: "agent-canonical",
      surfaces: [],
      events: [],
    });
    expect(history).toMatchObject({
      canonicalAgentId: "agent-canonical",
      surfaceCount: 0,
      events: [],
      counts: { decisions: 0, trust: 0, identity: 0, reviews: 0 },
    });
    expect(history.latestTrustScore).toBeUndefined();
  });
});
