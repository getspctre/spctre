import type { GrcEvidenceBridgeDelivery } from "./types";

export interface GrcDeliveryAttempt {
  attempt: number;
  status?: number;
  error?: string;
}

export interface GrcDeliveryResult {
  delivered: boolean;
  attempts: GrcDeliveryAttempt[];
}

/**
 * Worker-safe bridge delivery. Network transport is injected so request paths
 * cannot create arbitrary outbound calls; workers own destination selection.
 */
export async function deliverGrcEvidenceBridge(params: {
  delivery: GrcEvidenceBridgeDelivery;
  send: (request: {
    endpoint: string;
    headers: Record<string, string>;
    body: string;
  }) => Promise<{ status: number }>;
  maxAttempts?: number;
}): Promise<GrcDeliveryResult> {
  const { destination } = params.delivery;
  let url: URL;
  try {
    url = new URL(destination.endpoint);
  } catch {
    throw new Error("GRC destination endpoint must be an absolute URL.");
  }
  if (url.protocol !== "https:") throw new Error("GRC destination endpoint must use HTTPS.");
  const attempts: GrcDeliveryAttempt[] = [];
  const maxAttempts = Math.max(1, Math.min(params.maxAttempts ?? 3, 5));
  const body = JSON.stringify(params.delivery.payload);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await params.send({
        endpoint: destination.endpoint,
        body,
        headers: {
          "content-type": "application/json",
          "idempotency-key": params.delivery.idempotencyKey,
          "x-spctre-grc-schema": params.delivery.schemaVersion,
        },
      });
      attempts.push({ attempt, status: response.status });
      if (response.status >= 200 && response.status < 300) return { delivered: true, attempts };
      if (response.status < 500 && response.status !== 429) return { delivered: false, attempts };
    } catch (error) {
      attempts.push({ attempt, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { delivered: false, attempts };
}
