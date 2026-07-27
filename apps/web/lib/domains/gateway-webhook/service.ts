import { runWithTenantContext } from "@/lib/tenant-context";
import { appendOperationsLog } from "@/lib/repositories/operations-log/log";
import {
  createWebhookRegistration,
  listWebhookRegistrations,
  revokeWebhookRegistration,
  type WebhookProvider,
  type WebhookRegistration,
} from "@/lib/repositories/gateway-webhook";

export interface GatewayWebhookProviderMeta {
  id: WebhookProvider;
  label: string;
  /**
   * Header the provider must send the secret in on each inbound webhook. All
   * providers also accept the generic `x-spctre-gateway-secret` fallback.
   * Kept in sync with the `providerHeader` values in
   * app/api/gateway-ingest/<provider>/route.ts.
   */
  header: string;
}

export const GATEWAY_WEBHOOK_PROVIDERS: readonly GatewayWebhookProviderMeta[] = [
  { id: "portkey", label: "Portkey", header: "x-portkey-webhook-secret" },
  { id: "helicone", label: "Helicone", header: "helicone-signature" },
  { id: "litellm", label: "LiteLLM", header: "x-litellm-signature" },
  { id: "notion", label: "Notion", header: "x-notion-signature" },
] as const;

export function isGatewayWebhookProvider(value: string): value is WebhookProvider {
  return GATEWAY_WEBHOOK_PROVIDERS.some((provider) => provider.id === value);
}

/** List active (non-revoked) webhook registrations for a workspace. */
export async function listGatewayWebhookRegistrations(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<WebhookRegistration[]> {
  return runWithTenantContext(params.tenantId, () =>
    listWebhookRegistrations({ tenantId: params.tenantId, workspaceId: params.workspaceId })
  );
}

/**
 * Mint a new per-integration webhook secret bound to this tenant + workspace +
 * provider. The raw secret is returned once and never persisted (only its
 * sha256 hash is stored), so callers must surface it to the operator exactly
 * once.
 */
export async function createGatewayWebhookRegistration(params: {
  tenantId: string;
  workspaceId: string;
  provider: WebhookProvider;
  label?: string;
  createdBy: string;
}): Promise<{ registration: WebhookRegistration; secret: string }> {
  return runWithTenantContext(params.tenantId, async () => {
    const result = await createWebhookRegistration({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      provider: params.provider,
      label: params.label,
      createdBy: params.createdBy,
    });

    // Best-effort audit trail; a failed append must not fail the mint.
    await appendOperationsLog({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "TOKEN_ISSUED",
      sourceId: result.registration.id,
      sourceTable: "gateway_webhook_registration",
      actorId: params.createdBy,
      payload: {
        keyType: "GATEWAY_WEBHOOK",
        provider: params.provider,
        label: params.label ?? null,
      },
    }).catch(() => {});

    return result;
  });
}

/** Revoke a webhook registration. Returns false when it is missing or already revoked. */
export async function revokeGatewayWebhookRegistration(params: {
  id: string;
  tenantId: string;
  workspaceId: string;
  actorId: string;
}): Promise<boolean> {
  return runWithTenantContext(params.tenantId, async () => {
    const revoked = await revokeWebhookRegistration({
      id: params.id,
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
    });

    if (revoked) {
      await appendOperationsLog({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        eventType: "TOKEN_REVOKED",
        sourceId: params.id,
        sourceTable: "gateway_webhook_registration",
        actorId: params.actorId,
        payload: { keyType: "GATEWAY_WEBHOOK", revokedAt: new Date().toISOString() },
      }).catch(() => {});
    }

    return revoked;
  });
}
