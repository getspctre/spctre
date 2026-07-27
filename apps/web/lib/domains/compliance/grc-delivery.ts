import { deliverGrcEvidenceBridge, type GrcEvidenceBridgeDelivery } from "@spctre/policy-schema";
import { recordGrcDeliveryAttempt } from "@/lib/repositories/grc-delivery-attempts";

/** Worker entrypoint: execute a pre-authorized delivery and retain only outcome evidence. */
export async function deliverManagedGrcBridge(params: {
  tenantId: string;
  workspaceId: string;
  destinationId: string;
  delivery: GrcEvidenceBridgeDelivery;
  send: (request: { endpoint: string; headers: Record<string, string>; body: string }) => Promise<{ status: number }>;
}) {
  const result = await deliverGrcEvidenceBridge({ delivery: params.delivery, send: params.send });
  for (const attempt of result.attempts) {
    const retryable = !attempt.status || attempt.status === 429 || attempt.status >= 500;
    await recordGrcDeliveryAttempt({
      tenantId: params.tenantId, workspaceId: params.workspaceId, destinationId: params.destinationId,
      idempotencyKey: params.delivery.idempotencyKey, artifactHash: params.delivery.payload.provenance.artifactHash,
      status: attempt.status && attempt.status >= 200 && attempt.status < 300 ? "DELIVERED" : retryable ? "RETRYABLE_FAILURE" : "TERMINAL_FAILURE",
      httpStatus: attempt.status, errorCode: attempt.error?.slice(0, 128),
    });
  }
  return result;
}
