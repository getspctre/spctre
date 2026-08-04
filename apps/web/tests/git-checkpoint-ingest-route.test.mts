import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestRuntimeEvidenceSpy = vi.fn();
const revalidatePathSpy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathSpy }));
vi.mock("@/lib/domains/evidence/ingest-service", () => ({
  ingestRuntimeEvidence: ingestRuntimeEvidenceSpy,
}));

const route = await import("../app/api/v1/evidence/git-checkpoints/route");

const validPayload = {
  idempotencyKey: "checkpoint:repo-1:cp-1",
  environment: "production",
  status: "WARN",
  reason: "Sensitive configuration path changed.",
  agent: { id: "agent-1", adapter: "ci-hook" },
  connector: "git",
  checkpoint: {
    id: "cp-1",
    createdAt: "2026-07-20T14:30:00Z",
    repository: { id: "repo-1" },
    headCommit: "abc123",
    diff: { format: "name-status", files: [{ path: ".env.example", status: "modified" }] },
  },
};

describe("POST /api/v1/evidence/git-checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingestRuntimeEvidenceSpy.mockResolvedValue({
      status: 201,
      body: { evidence: { decisionId: validPayload.idempotencyKey, status: "WARN" } },
      revalidatePaths: ["/evidence"],
      spanAttributes: { "spctre.evidence.status": "WARN" },
    });
  });

  it("normalizes checkpoint metadata into gateway-mode evidence", async () => {
    const response = await route.POST(
      new Request("http://localhost:3000/api/v1/evidence/git-checkpoints", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "git-checkpoint-test" },
        body: JSON.stringify(validPayload),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      evidence: { decisionId: validPayload.idempotencyKey },
      meta: { traceId: "git-checkpoint-test" },
    });
    expect(ingestRuntimeEvidenceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        parsed: expect.objectContaining({
          decisionId: validPayload.idempotencyKey,
          ingestMode: "gateway",
          artifactHash: "abc123",
          rawEvidence: expect.objectContaining({ _source: "git-checkpoint" }),
        }),
      }),
    );
    expect(revalidatePathSpy).toHaveBeenCalledWith("/evidence");
  });

  it("rejects a diff without a representation", async () => {
    const response = await route.POST(
      new Request("http://localhost:3000/api/v1/evidence/git-checkpoints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...validPayload,
          checkpoint: { ...validPayload.checkpoint, diff: { format: "unified" } },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(ingestRuntimeEvidenceSpy).not.toHaveBeenCalled();
  });
});
