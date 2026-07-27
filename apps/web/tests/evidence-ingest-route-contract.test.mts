import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestRuntimeEvidenceSpy = vi.fn();
const delegateToGoIngestorSpy = vi.fn();
const revalidatePathSpy = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathSpy,
}));

vi.mock("@/lib/domains/evidence/ingest-service", () => ({
  ingestRuntimeEvidence: ingestRuntimeEvidenceSpy,
}));

vi.mock("../app/api/evidence/ingest-helpers", () => ({
  delegateToGoIngestor: delegateToGoIngestorSpy,
}));

const evidenceRoute = await import("../app/api/evidence/route");

const validPayload = {
  decisionId: "dec-route-contract",
  tenantId: "tenant-route",
  workspaceId: "workspace-route",
  environment: "production",
  runtimeTarget: { stack: "LOCAL", adapter: "codex-hook" },
  agentId: "agent-route",
  connector: "stripe",
  action: "refund.create",
  status: "ALLOW",
  reason: "allowed",
  policyRefs: ["stripe.refund.allow"],
  artifactHash: "sha256:route",
  policyContext: [
    {
      scope: "WORKSPACE",
      branchId: "branch-route",
      revisionId: "revision-route",
      artifactHash: "sha256:route",
    },
  ],
};

describe("POST /api/evidence contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delegateToGoIngestorSpy.mockResolvedValue(null);
    ingestRuntimeEvidenceSpy.mockResolvedValue({
      status: 201,
      body: {
        evidence: {
          decisionId: "dec-route-contract",
          status: "ALLOW",
        },
        gateway: undefined,
      },
      revalidatePaths: ["/evidence", "/compliance"],
      spanAttributes: {
        "spctre.evidence.status": "ALLOW",
      },
    });
  });

  it("wraps successful ingest responses with trace metadata and revalidates returned paths", async () => {
    const response = await evidenceRoute.POST(
      new Request("http://localhost:3000/api/evidence", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "trace-route-contract",
        },
        body: JSON.stringify(validPayload),
      })
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("trace-route-contract");
    await expect(response.json()).resolves.toMatchObject({
      evidence: {
        decisionId: "dec-route-contract",
        status: "ALLOW",
      },
      meta: {
        traceId: "trace-route-contract",
      },
    });
    expect(ingestRuntimeEvidenceSpy).toHaveBeenCalledWith(expect.objectContaining({
      parsed: expect.objectContaining({
        decisionId: "dec-route-contract",
        artifactHash: "sha256:route",
      }),
      rawPayload: expect.objectContaining({
        decisionId: "dec-route-contract",
      }),
    }));
    expect(revalidatePathSpy).toHaveBeenCalledWith("/evidence");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/compliance");
  });

  it("returns a stable JSON error envelope for invalid JSON", async () => {
    const response = await evidenceRoute.POST(
      new Request("http://localhost:3000/api/evidence", {
        method: "POST",
        headers: { "x-request-id": "trace-invalid-json" },
        body: "{",
      })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe("trace-invalid-json");
    await expect(response.json()).resolves.toMatchObject({
      error: "Request body must be JSON.",
      meta: {
        traceId: "trace-invalid-json",
      },
    });
    expect(ingestRuntimeEvidenceSpy).not.toHaveBeenCalled();
  });

  it("returns parse issues without calling the ingest service", async () => {
    const response = await evidenceRoute.POST(
      new Request("http://localhost:3000/api/evidence", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "trace-parse-issues",
        },
        body: JSON.stringify({ decisionId: "missing-required-fields" }),
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error?: string; issues?: unknown[]; meta?: { traceId?: string } };
    expect(body.error).toMatch(/^environment: /);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.meta?.traceId).toBe("trace-parse-issues");
    expect(ingestRuntimeEvidenceSpy).not.toHaveBeenCalled();
  });
});
