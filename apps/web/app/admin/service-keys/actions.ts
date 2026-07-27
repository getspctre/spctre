"use server";

import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { recordAuthOperation, revokeServiceKeyById } from "@/lib/domains/auth/service";

import { ADMIN_ISSUABLE_API_KEY_SCOPES, issueServiceAccountKey, type ServiceTokenScope } from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";

export type ServiceKeyActionState =
  | { ok: true; rawToken: string; label: string; tokenPrefix: string; error?: never; errorCode?: never }
  | { ok?: never; rawToken?: never; label?: never; tokenPrefix?: never; error: string; errorCode?: string }
  | null;

export type ServiceKeyMutationState =
  | { ok: true; message: string; messageCode?: string; error?: never; errorCode?: never }
  | { ok?: never; message?: never; messageCode?: never; error: string; errorCode?: string }
  | null;

async function requireKeyAdmin() {
  const session = await getAuthSession().catch(() => null);
  if (!session) return { error: "Authentication required.", errorCode: "auth_required" } as const;
  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return { error: "Workspace context unavailable.", errorCode: "workspace_unavailable" } as const;
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(() => null);
  if (!actor?.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission is required.", errorCode: "admin_required" } as const;
  }
  return { session, ctx } as const;
}

export async function createServiceKey(
  _prev: ServiceKeyActionState,
  formData: FormData
): Promise<ServiceKeyActionState> {
  const guard = await requireKeyAdmin();
  if ("error" in guard) {
    return {
      error: guard.error ?? "Permission denied.",
      errorCode: guard.errorCode ?? "permission_denied",
    };
  }

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) {
    return { error: writeCheck.error ?? "Write access denied.", errorCode: "write_denied" };
  }

  const label = String(formData.get("label") ?? "").trim().slice(0, 64);
  if (!label) return { error: "A label is required.", errorCode: "label_required" };

  const rawScopes = formData.getAll("scopes").map(String);
  const scopes = rawScopes.filter((s): s is ServiceTokenScope =>
    ADMIN_ISSUABLE_API_KEY_SCOPES.includes(s as ServiceTokenScope)
  );
  if (!scopes.length) return { error: "Select at least one scope.", errorCode: "scope_required" };

  const expiresInDaysRaw = Number(formData.get("expiresInDays") ?? "");
  const expiresInDays = Number.isFinite(expiresInDaysRaw) && expiresInDaysRaw >= 1 && expiresInDaysRaw <= 365
    ? expiresInDaysRaw
    : undefined;

  const result = await issueServiceAccountKey({
    tenantId: guard.session.tenantId,
    workspaceId: guard.ctx.workspaceId,
    principalId: guard.session.principalId,
    createdBy: guard.session.principalId,
    label,
    scopes,
    expiresInDays,
  });

  recordAuthOperation({
    tenantId: guard.session.tenantId,
    workspaceId: guard.ctx.workspaceId,
    eventType: "TOKEN_ISSUED",
    sourceId: result.tokenId,
    sourceTable: "service_token",
    actorId: guard.session.principalId,
    payload: { label, scopes, keyType: "API_KEY", expiresInDays: expiresInDays ?? null },
  }).catch(() => {});

  revalidatePath("/admin/service-keys");
  return { ok: true, rawToken: result.rawToken, label, tokenPrefix: result.tokenPrefix };
}

export async function revokeServiceKey(
  _prev: ServiceKeyMutationState,
  formData: FormData
): Promise<ServiceKeyMutationState> {
  const guard = await requireKeyAdmin();
  if ("error" in guard) {
    return {
      error: guard.error ?? "Permission denied.",
      errorCode: guard.errorCode ?? "permission_denied",
    };
  }

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) {
    return { error: writeCheck.error ?? "Write access denied.", errorCode: "write_denied" };
  }

  const keyId = String(formData.get("keyId") ?? "").trim();
  if (!keyId) return { error: "Service key is missing.", errorCode: "missing_key" };

  const revoked = await revokeServiceKeyById({
    keyId,
    tenantId: guard.session.tenantId,
    workspaceId: guard.ctx.workspaceId,
  });
  if (revoked === null) {
    return {
      error: "Service key was not found or is already revoked.",
      errorCode: "not_found",
    };
  }

  recordAuthOperation({
    tenantId: guard.session.tenantId,
    workspaceId: guard.ctx.workspaceId,
    eventType: "TOKEN_REVOKED",
    sourceId: keyId,
    sourceTable: "service_token",
    actorId: guard.session.principalId,
    payload: { keyId, revokedAt: new Date().toISOString() },
  }).catch(() => {});

  revalidatePath("/admin/service-keys");
  return { ok: true, message: "Service key revoked.", messageCode: "revoked" };
}
