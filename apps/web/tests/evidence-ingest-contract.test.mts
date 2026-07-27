import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceIngestInput } from "@spctre/api-contracts";

const appendOperationsLogSpy = vi.fn(async () => undefined);
const authenticateServiceTokenSpy = vi.fn();
const insertRuntimeEvidenceWithDedupSpy = vi.fn();
const persistGatewayDecisionSpy = vi.fn();
const recordConversionTelemetrySpy = vi.fn(async () => undefined);

vi.mock("@/lib/repositories/operations-log", () => ({
  appendOperationsLog: appendOperationsLogSpy,
}));

vi.mock("@/lib/repositories/evidence", () => ({
  countMonthlyEvidenceEvents: vi.fn(),
  countTotalEvidenceEvents: vi.fn(async () => 0),
  ensureEvidenceDemoTenant: vi.fn(async () => undefined),
  insertRuntimeEvidenceWithDedup: insertRuntimeEvidenceWithDedupSpy,
  isEvidenceDatabaseConfigured: () => true,
  validateEvidencePolicyContextBoundary: vi.fn(async () => ({ ok: true })),
  validateEvidenceWorkspaceBoundary: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/repositories/workspace", () => ({
  getCommercialProfile: vi.fn(async () => ({ planCode: "TEAM" })),
}));

vi.mock("@/lib/repositories/trust", () => ({
  ingestTrustScoreEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/repositories/onboarding/telemetry", () => ({
  recordConversionTelemetry: recordConversionTelemetrySpy,
}));

vi.mock("@/lib/repositories/auth/session", () => ({
  resolveTenantIdOrDemo: (tenantId: string | null | undefined) => tenantId?.trim() ?? "",
  resolveWorkspaceIdOrDemo: (workspaceId: string | null | undefined) => workspaceId?.trim() || null,
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: authenticateServiceTokenSpy,
  hasBearerToken: (request: Request) => (request.headers.get("authorization") ?? "").startsWith("Bearer "),
}));

vi.mock("@/lib/platform/config", () => ({
  isGatewayEnabled: () => false,
}));

vi.mock("@/lib/repositories/gateway", () => ({
  persistGatewayDecision: persistGatewayDecisionSpy,
}));

const { ingestRuntimeEvidence } = await import("../lib/domains/evidence/ingest-service");

const baseParsed: EvidenceIngestInput = {
  decisionId: "dec-contract-1",
  tenantId: "tenant-real",
  workspaceId: "workspace-real",
  environment: "production",
  runtimeTarget: { stack: "LOCAL", adapter: "codex-hook" },
  agentId: "agent-contract",
  connector: "stripe",
  action: "refund.create",
  status: "ALLOW",
  reason: "policy allowed",
  policyRefs: ["stripe.refund.approval"],
  artifactHash: "sha256:contract",
  policyContext: [
    {
      scope: "WORKSPACE",
      branchId: "branch-contract",
      revisionId: "revision-contract",
      artifactHash: "sha256:contract",
    },
  ],
  latencyMs: 12,
  createdAt: "2026-07-08T00:00:00.000Z",
  rawEvidence: { requestId: "req-contract" },
};

function evidenceRequest(headers: HeadersInit = { authorization: "Bearer token" }) {
  return new Request("http://localhost:3000/api/evidence", {
    method: "POST",
    headers,
  });
}

function ingest(parsed: EvidenceIngestInput = baseParsed, headers?: HeadersInit) {
  return ingestRuntimeEvidence({
    request: evidenceRequest(headers),
    parsed,
    rawPayload: parsed as unknown,
    startedAt: Date.now(),
  });
}

describe("evidence ingest contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateServiceTokenSpy.mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "tenant-real",
        workspaceId: "workspace-real",
        principalId: "svc-contract",
        scopes: ["evidence:write"],
      },
    });
    insertRuntimeEvidenceWithDedupSpy.mockResolvedValue({ inserted: true });
  });

  it("returns the evidence contract and appends stable operations-log provenance fields", async () => {
    const result = await ingest();

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      evidence: {
        decisionId: "dec-contract-1",
        tenantId: "tenant-real",
        workspaceId: "workspace-real",
        environment: "production",
        agentId: "agent-contract",
        connector: "stripe",
        action: "refund.create",
        status: "ALLOW",
        artifactHash: "sha256:contract",
      },
      gateway: undefined,
    });
    expect(result.revalidatePaths).toEqual(["/evidence", "/compliance", "/agents", "/escalations"]);
    expect(result.spanAttributes).toMatchObject({
      "spctre.tenant_id": "tenant-real",
      "spctre.workspace_id": "workspace-real",
      "spctre.evidence.status": "ALLOW",
      "spctre.gateway.outcome": "not_evaluated",
    });

    expect(insertRuntimeEvidenceWithDedupSpy).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-real",
      workspaceId: "workspace-real",
      rawEvidenceWithSource: expect.objectContaining({
        requestId: "req-contract",
        _source: "hook",
      }),
    }));
    expect(appendOperationsLogSpy).toHaveBeenCalledTimes(1);
    expect(appendOperationsLogSpy).toHaveBeenCalledWith({
      tenantId: "tenant-real",
      workspaceId: "workspace-real",
      eventType: "EVIDENCE_INGEST",
      sourceId: "dec-contract-1",
      sourceTable: "runtime_evidence_event",
      actorId: "svc-contract",
      payload: {
        agentId: "agent-contract",
        connector: "stripe",
        action: "refund.create",
        status: "ALLOW",
        artifactHash: "sha256:contract",
        runtimeStack: "LOCAL",
        governanceActive: false,
        runtimeAdapter: "codex-hook",
      },
    });
    expect(recordConversionTelemetrySpy).toHaveBeenCalledWith("tenant-real", "FIRST_EVIDENCE_INGEST");
  });

  it("suppresses side effects on duplicate decision ingest", async () => {
    insertRuntimeEvidenceWithDedupSpy.mockResolvedValueOnce({ inserted: false });

    const result = await ingest();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      deduplicated: true,
      evidence: { decisionId: "dec-contract-1" },
    });
    expect(appendOperationsLogSpy).not.toHaveBeenCalled();
    expect(recordConversionTelemetrySpy).not.toHaveBeenCalled();
    expect(persistGatewayDecisionSpy).not.toHaveBeenCalled();
  });

  it("rejects missing bearer tokens before persistence or operations logging", async () => {
    const result = await ingest(baseParsed, {});

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Missing bearer token. Issue one with: spctre init" });
    expect(authenticateServiceTokenSpy).not.toHaveBeenCalled();
    expect(insertRuntimeEvidenceWithDedupSpy).not.toHaveBeenCalled();
    expect(appendOperationsLogSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed non-gateway evidence before auth and persistence", async () => {
    const result = await ingest({
      ...baseParsed,
      artifactHash: "",
      policyRefs: [],
      policyContext: [],
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "policyRefs must include at least one policy reference." });
    expect(authenticateServiceTokenSpy).not.toHaveBeenCalled();
    expect(insertRuntimeEvidenceWithDedupSpy).not.toHaveBeenCalled();
    expect(appendOperationsLogSpy).not.toHaveBeenCalled();
  });
});
