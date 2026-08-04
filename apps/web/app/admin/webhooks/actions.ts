"use server";

import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { getActiveScope } from "@/lib/workspace";
import { verifyWriteAccess } from "@/lib/demo-guard";
import {
  createGatewayWebhookRegistration,
  isGatewayWebhookProvider,
  revokeGatewayWebhookRegistration,
} from "@/lib/domains/gateway-webhook/service";
import { swallow } from "@/lib/platform/swallow";

export type WebhookActionState =
  | {
      ok: true;
      secret: string;
      provider: string;
      label: string | null;
      error?: never;
      errorCode?: never;
    }
  | {
      ok?: never;
      secret?: never;
      provider?: never;
      label?: never;
      error: string;
      errorCode?: string;
    }
  | null;

export type WebhookMutationState =
  | { ok: true; message: string; messageCode?: string; error?: never; errorCode?: never }
  | { ok?: never; message?: never; messageCode?: never; error: string; errorCode?: string }
  | null;

async function requireWebhookAdmin() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required.", errorCode: "auth_required" } as const;
  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx)
    return { error: "Workspace context unavailable.", errorCode: "workspace_unavailable" } as const;
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission is required.", errorCode: "admin_required" } as const;
  }
  return { session, ctx } as const;
}

export async function createGatewayWebhook(
  _prev: WebhookActionState,
  formData: FormData,
): Promise<WebhookActionState> {
  const guard = await requireWebhookAdmin();
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

  const provider = String(formData.get("provider") ?? "").trim();
  if (!isGatewayWebhookProvider(provider)) {
    return { error: "Select a supported provider.", errorCode: "unsupported_provider" };
  }

  const labelRaw = String(formData.get("label") ?? "")
    .trim()
    .slice(0, 64);
  const label = labelRaw || undefined;

  const result = await createGatewayWebhookRegistration({
    tenantId: guard.session.tenantId,
    workspaceId: guard.ctx.workspaceId,
    provider,
    label,
    createdBy: guard.session.principalId,
  });

  revalidatePath("/admin/webhooks");
  return { ok: true, secret: result.secret, provider, label: label ?? null };
}

export async function revokeGatewayWebhook(
  _prev: WebhookMutationState,
  formData: FormData,
): Promise<WebhookMutationState> {
  const guard = await requireWebhookAdmin();
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

  const id = String(formData.get("registrationId") ?? "").trim();
  if (!id) return { error: "Webhook registration is missing.", errorCode: "missing_registration" };

  const revoked = await revokeGatewayWebhookRegistration({
    id,
    tenantId: guard.session.tenantId,
    workspaceId: guard.ctx.workspaceId,
    actorId: guard.session.principalId,
  });
  if (!revoked) {
    return { error: "Webhook was not found or is already revoked.", errorCode: "not_found" };
  }

  revalidatePath("/admin/webhooks");
  return { ok: true, message: "Webhook secret revoked.", messageCode: "revoked" };
}
