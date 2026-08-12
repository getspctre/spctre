/**
 * §21 hardening — retention-aware prune, revocation history, and
 * framework-annotated compliance exports.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRouteRequest } from "./route-test-helper";

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ principalId: "user-test" }),
}));

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: vi.fn().mockResolvedValue({ tenantId: "demo-tenant", workspaceId: "demo-ws" }),
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi
    .fn()
    .mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        principalId: "svc-test",
        scopes: ["evidence:write"],
      },
    }),
  hasBearerToken: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── /api/evidence/prune ───────────────────────────────────────────────────────

const pruneExpiredEvidenceMock = vi.fn();

vi.mock("@/lib/domains/compliance/service", () => ({
  pruneExpiredEvidence: pruneExpiredEvidenceMock,
  getCompliancePacket: vi
    .fn()
    .mockResolvedValue({
      export: {
        artifact: { branchId: "b-1", revisionId: "rev-1", artifactHash: "sha256:abc", rules: [] },
        readiness: { approvals: [{ approvedBy: "user-1", approvedAt: "2026-01-01T00:00:00Z" }] },
        evidenceCount: 50,
        approvalCount: 1,
        policyRefCount: 12,
        deniedDecisionCount: 5,
        warnedDecisionCount: 3,
        simulationEventCount: 0,
        packageSections: [],
        artifactHash: "sha256:abc",
      },
      timeline: { events: [], branchId: "b-1", revisionId: "rev-1" },
      escalations: [
        {
          id: "esc-1",
          decisionId: "dec-1",
          artifactHash: "sha256:abc",
          resolutionOutcome: "PROCEED",
          resolvedAt: "2026-05-01T00:00:00Z",
        },
      ],
    }),
  getEvidenceRetentionPlan: vi.fn().mockResolvedValue(null),
  getComplianceOperationsEventCounts: vi.fn().mockResolvedValue({}),
  getComplianceVerificationStatus: vi.fn().mockResolvedValue(null),
  recordComplianceExportConversion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/repositories/mfa", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/repositories/mfa")>();
  return {
    ...real,
    listRevocationHistory: vi
      .fn()
      .mockResolvedValue([
        {
          tokenId: "tok-1",
          tenantId: "demo-tenant",
          workspaceId: "demo-ws",
          principalId: "svc-a",
          scopes: ["evidence:write"],
          revokedAt: "2026-05-01T10:00:00Z",
          createdAt: "2026-04-01T10:00:00Z",
        },
      ]),
  };
});

vi.mock("@/lib/repositories/operations-log", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/repositories/operations-log")>();
  return {
    ...real,
    getOperationsLogEventCounts: vi
      .fn()
      .mockResolvedValue({
        EVIDENCE_INGEST: 50,
        POLICY_PUBLISH: 1,
        TOKEN_ISSUED: 3,
        TOKEN_REVOKED: 1,
        IDENTITY_CHANGE: 5,
        VERIFICATION_RUN: 1,
        COMPLIANCE_EXPORT: 2,
      }),
  };
});

vi.mock("@/lib/repositories/verification", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/repositories/verification")>();
  return { ...real, getLatestVerificationStatus: vi.fn().mockResolvedValue(null) };
});

const { POST: prunePost } = await import("../app/api/evidence/prune/route");
const { GET: revocationsGet } = await import("../app/api/token/revocations/route");
const { GET: complianceExportGet } = await import("../app/api/compliance/export/route");

beforeEach(() => {
  vi.clearAllMocks();
  pruneExpiredEvidenceMock.mockReset();
});

// ── evidence/prune ────────────────────────────────────────────────────────────

describe("POST /api/evidence/prune", () => {
  it("returns 200 with prunedCount when prune succeeds", async () => {
    pruneExpiredEvidenceMock.mockResolvedValue({
      prunedCount: 3,
      prunedDecisionIds: ["d-1", "d-2", "d-3"],
    });

    const req = createRouteRequest({ path: "/api/evidence/prune", token: "svc-token" });

    const res = await prunePost(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.prunedCount).toBe(3);
    expect(Array.isArray(body.prunedDecisionIds)).toBe(true);
  });

  it("returns prunedCount: 0 when nothing expired", async () => {
    pruneExpiredEvidenceMock.mockResolvedValue({ prunedCount: 0, prunedDecisionIds: [] });

    const req = createRouteRequest({ path: "/api/evidence/prune", token: "svc-token" });

    const res = await prunePost(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { prunedCount: number };
    expect(body.prunedCount).toBe(0);
  });

  it("returns 500 when prune throws", async () => {
    pruneExpiredEvidenceMock.mockRejectedValue(new Error("DB error"));

    const req = createRouteRequest({ path: "/api/evidence/prune", token: "svc-token" });

    const res = await prunePost(req);
    expect(res.status).toBe(500);
  });
});

// ── token/revocations ─────────────────────────────────────────────────────────

describe("GET /api/token/revocations", () => {
  it("returns 200 with revocations array", async () => {
    const req = new Request("http://localhost:3000/api/token/revocations");
    const res = await revocationsGet(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.revocations)).toBe(true);
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("generatedAt");
    expect(body).toHaveProperty("pagination");
  });

  it("revocation records include revokedAt and principalId", async () => {
    const req = new Request("http://localhost:3000/api/token/revocations");
    const res = await revocationsGet(req);
    const body = (await res.json()) as { revocations: Array<Record<string, unknown>> };

    expect(body.revocations.length).toBeGreaterThan(0);
    const record = body.revocations[0];
    expect(record).toHaveProperty("revokedAt");
    expect(record).toHaveProperty("principalId");
    expect(record).toHaveProperty("tokenId");
  });

  it("respects limit param", async () => {
    const req = new Request("http://localhost:3000/api/token/revocations?limit=10");
    const res = await revocationsGet(req);
    expect(res.status).toBe(200);
  });
});

// ── compliance/export?framework= ─────────────────────────────────────────────

describe("GET /api/compliance/export — framework annotation", () => {
  it("includes frameworkAnnotation when framework=soc2", async () => {
    const req = new Request("http://localhost:3000/api/compliance/export?framework=soc2");
    const res = await complianceExportGet(req);
    expect(res.status).toBe(200);

    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body.frameworkAnnotation).not.toBeNull();

    const ann = body.frameworkAnnotation as Record<string, unknown>;
    expect(ann.framework).toBe("soc2");
    expect(Array.isArray(ann.controls)).toBe(true);
    expect(ann).toHaveProperty("summary");
  });

  it("includes frameworkAnnotation when framework=eu-ai-act", async () => {
    const req = new Request("http://localhost:3000/api/compliance/export?framework=eu-ai-act");
    const res = await complianceExportGet(req);
    expect(res.status).toBe(200);

    const body = JSON.parse(await res.text()) as { frameworkAnnotation: { framework: string } };
    expect(body.frameworkAnnotation.framework).toBe("eu-ai-act");
  });

  it("includes frameworkAnnotation when framework=hipaa", async () => {
    const req = new Request("http://localhost:3000/api/compliance/export?framework=hipaa");
    const res = await complianceExportGet(req);
    expect(res.status).toBe(200);

    const body = JSON.parse(await res.text()) as { frameworkAnnotation: { framework: string } };
    expect(body.frameworkAnnotation.framework).toBe("hipaa");
  });

  it("sets frameworkAnnotation to null when no framework param", async () => {
    const req = new Request("http://localhost:3000/api/compliance/export");
    const res = await complianceExportGet(req);
    expect(res.status).toBe(200);

    const body = JSON.parse(await res.text()) as { frameworkAnnotation: null };
    expect(body.frameworkAnnotation).toBeNull();
  });

  it("sets frameworkAnnotation to null for unknown framework value", async () => {
    const req = new Request(
      "http://localhost:3000/api/compliance/export?framework=not-a-real-framework",
    );
    const res = await complianceExportGet(req);
    expect(res.status).toBe(200);

    const body = JSON.parse(await res.text()) as { frameworkAnnotation: null };
    expect(body.frameworkAnnotation).toBeNull();
  });
});
