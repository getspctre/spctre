import { runWithTenantContext } from "@/lib/tenant-context";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { appendOperationsLog } from "@/lib/repositories/operations-log/log";
import { getCommercialProfileWithContext } from "@/lib/repositories/workspace/commercial";
import {
  createScimTokenRegistration,
  listScimTokenRegistrations,
  resolveScimTokenBySecret,
  revokeScimTokenRegistration,
  type ScimTokenRegistration,
} from "@/lib/repositories/scim-token";
import { swallow } from "@/lib/platform/swallow";

export type ScimTokenBindingResult =
  | { ok: true; tenantId: string; registrationId: string }
  | { ok: false; reason: "unknown_token" | "not_entitled" };

/**
 * Whether SCIM provisioning is entitled for this tenant. Self-hosted
 * enterprise deployments are entitled as a whole; hosted deployments require
 * the tenant's commercial plan to be ENTERPRISE.
 */
export async function isScimProvisioningEntitled(tenantId: string): Promise<boolean> {
  const plan = getSpctrePlan();
  if (plan === "enterprise") return true;
  if (plan === "oss") return false;
  const profile = await getCommercialProfileWithContext(tenantId);
  return profile.planCode === "ENTERPRISE";
}

/**
 * Resolve a DB-bound SCIM bearer token to the tenant it provisions into.
 * Runs before tenant context exists, then enforces per-tenant entitlement so
 * a token minted while entitled stops working after a downgrade.
 */
export async function resolveScimTokenBinding(token: string): Promise<ScimTokenBindingResult> {
  const resolved = await resolveScimTokenBySecret(token);
  if (!resolved) return { ok: false, reason: "unknown_token" };

  const entitled = await isScimProvisioningEntitled(resolved.tenantId);
  if (!entitled) return { ok: false, reason: "not_entitled" };

  return { ok: true, tenantId: resolved.tenantId, registrationId: resolved.registrationId };
}

/** List active (non-revoked) SCIM tokens for a tenant. */
export async function listScimTokens(params: {
  tenantId: string;
}): Promise<ScimTokenRegistration[]> {
  return runWithTenantContext(params.tenantId, () =>
    listScimTokenRegistrations({ tenantId: params.tenantId })
  );
}

/**
 * Mint a new per-tenant SCIM provisioning token. The raw token is returned
 * once and never persisted (only its sha256 hash is stored), so callers must
 * surface it to the operator exactly once.
 */
export async function createScimToken(params: {
  tenantId: string;
  label?: string;
  createdBy: string;
}): Promise<{ registration: ScimTokenRegistration; token: string }> {
  return runWithTenantContext(params.tenantId, async () => {
    const result = await createScimTokenRegistration({
      tenantId: params.tenantId,
      label: params.label,
      createdBy: params.createdBy,
    });

    // Best-effort audit trail; a failed append must not fail the mint.
    await appendOperationsLog({
      tenantId: params.tenantId,
      eventType: "TOKEN_ISSUED",
      sourceId: result.registration.id,
      sourceTable: "scim_token_registration",
      actorId: params.createdBy,
      payload: {
        keyType: "SCIM_PROVISIONING",
        label: params.label ?? null,
      },
    }).catch(swallow("appendOperationsLog", undefined));

    return result;
  });
}

/** Revoke a SCIM token. Returns false when it is missing or already revoked. */
export async function revokeScimToken(params: {
  id: string;
  tenantId: string;
  actorId: string;
}): Promise<boolean> {
  return runWithTenantContext(params.tenantId, async () => {
    const revoked = await revokeScimTokenRegistration({
      id: params.id,
      tenantId: params.tenantId,
    });

    if (revoked) {
      await appendOperationsLog({
        tenantId: params.tenantId,
        eventType: "TOKEN_REVOKED",
        sourceId: params.id,
        sourceTable: "scim_token_registration",
        actorId: params.actorId,
        payload: { keyType: "SCIM_PROVISIONING", revokedAt: new Date().toISOString() },
      }).catch(swallow("appendOperationsLog", undefined));
    }

    return revoked;
  });
}
