import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverSpy = vi.fn();
const recordSpy = vi.fn(async () => undefined);

vi.mock("@spctre/policy-schema", () => ({ deliverGrcEvidenceBridge: deliverSpy }));
vi.mock("@/lib/repositories/grc-delivery-attempts", () => ({ recordGrcDeliveryAttempt: recordSpy }));

const service = await import("../lib/domains/compliance/grc-delivery");
const delivery = {
  schemaVersion: "spctre.grc-evidence-delivery.v1", destination: { kind: "webhook", endpoint: "https://grc.example.test" }, idempotencyKey: "idem-1",
  payload: { schemaVersion: "spctre.grc-evidence-bridge.v1", generatedAt: "2026-07-16T00:00:00.000Z", provenance: { artifactHash: "sha256:artifact", branchId: "branch-1", revisionId: "revision-1" }, evidence: { packageId: "cmp-1", evidenceCount: 0, deniedDecisionCount: 0, warnedDecisionCount: 0, controlMappings: [] } },
} as const;

describe("managed GRC bridge delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records retryable and delivered outcomes without payload storage", async () => {
    deliverSpy.mockResolvedValue({ delivered: true, attempts: [{ attempt: 1, status: 503 }, { attempt: 2, status: 202 }] });
    await service.deliverManagedGrcBridge({ tenantId: "tenant-1", workspaceId: "workspace-1", destinationId: "destination-1", delivery, send: vi.fn() });
    expect(recordSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "RETRYABLE_FAILURE", httpStatus: 503, artifactHash: "sha256:artifact" }));
    expect(recordSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "DELIVERED", httpStatus: 202 }));
    expect(JSON.stringify(recordSpy.mock.calls)).not.toContain("controlMappings");
  });

  it("records a client rejection as terminal without retry classification", async () => {
    deliverSpy.mockResolvedValue({ delivered: false, attempts: [{ attempt: 1, status: 400 }] });
    await service.deliverManagedGrcBridge({ tenantId: "tenant-1", workspaceId: "workspace-1", destinationId: "destination-1", delivery, send: vi.fn() });
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "TERMINAL_FAILURE", httpStatus: 400 }));
  });
});
