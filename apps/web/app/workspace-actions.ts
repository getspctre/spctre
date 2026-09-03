"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/cookies";
import {
  switchWorkspace,
  createWorkspace as createWorkspaceService,
  switchTenant,
  switchActor as switchActorService,
} from "@/lib/domains/workspace/service";
import { getAuthSession, SESSION_COOKIE, sessionTtlHours } from "@/lib/auth-session";
import { createSessionGuardToken, SESSION_GUARD_COOKIE } from "@/lib/session-guard";
import { getWorkspaceContext } from "@/lib/workspace";
import { isFeatureEntitled } from "@/lib/entitlements/features";
import { swallow } from "@/lib/platform/swallow";

export type WorkspaceSwitchState =
  { workspaceId: string; error?: never } | { error: string; workspaceId?: never } | null;

export type WorkspaceCreateState =
  | { workspaceId: string; slug: string; error?: never }
  | { error: string; workspaceId?: never; slug?: never }
  | null;

export type ActorSwitchState =
  { actorId: string; error?: never } | { error: string; actorId?: never } | null;

export type TenantSwitchState =
  | { tenantId: string; workspaceSlug: string | null; requiresMfa: boolean; error?: never }
  | { error: string; tenantId?: never }
  | null;

export async function setActiveWorkspace(
  _prev: WorkspaceSwitchState,
  formData: FormData,
): Promise<WorkspaceSwitchState> {
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  if (!workspaceId) return { error: "Workspace is required." };

  const cookieStore = await cookies();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required." };
  const tenantId = session.tenantId;

  const result = await switchWorkspace({ workspaceId, tenantId });
  if ("error" in result) {
    return { error: result.error };
  }

  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");
  revalidatePath("/agents");
  revalidatePath("/compliance");
  revalidatePath("/packs");

  return { workspaceId };
}

export async function createWorkspace(
  _prev: WorkspaceCreateState,
  formData: FormData,
): Promise<WorkspaceCreateState> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required." };
  const tenantId = session.tenantId;
  const principalId = session.principalId;

  const workspaceName = String(formData.get("workspaceName") ?? "").trim();
  if (!workspaceName) return { error: "Workspace name is required." };

  const result = await createWorkspaceService({ tenantId, principalId, workspaceName });

  if ("error" in result) {
    return { error: result.error };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");
  revalidatePath("/agents");
  revalidatePath("/compliance");
  revalidatePath("/packs");

  return { workspaceId: result.workspaceId, slug: result.slug };
}

export async function setActiveTenant(
  _prev: TenantSwitchState,
  formData: FormData,
): Promise<TenantSwitchState> {
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId) return { error: "Tenant is required." };

  const cookieStore = await cookies();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required." };

  // The entitlement belongs to the tenant the session is currently in — the one
  // being switched away from. Reading it from the requested tenant would let a
  // caller buy their way into another tenant by naming it in the form, and the
  // check now needs a tenant at all, so it sits below the session load.
  if (!(await isFeatureEntitled("multiTenantWorkspaceIsolation", session.tenantId))) {
    return { error: "Switching tenants requires the Enterprise plan." };
  }

  const principalId = session.principalId;
  const currentTenantId = session.tenantId;
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value ?? session?.sessionId;

  const result = await switchTenant({
    tenantId,
    currentTenantId,
    principalId,
    subject: session.subject,
    sessionId,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  if (result.firstWorkspaceId) {
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, result.firstWorkspaceId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  if (
    sessionId &&
    result.requiresMfa !== undefined &&
    result.targetPrincipalId &&
    result.targetPrincipalSubject
  ) {
    const ttlSeconds = sessionTtlHours() * 60 * 60;
    const guardToken = await createSessionGuardToken({
      sid: sessionId,
      tid: tenantId,
      pid: result.targetPrincipalId,
      sub: result.targetPrincipalSubject,
      mfaVerified: !result.requiresMfa,
      ttlSeconds,
    });
    cookieStore.set(SESSION_GUARD_COOKIE, guardToken, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: ttlSeconds,
    });
  }

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");
  revalidatePath("/agents");
  revalidatePath("/compliance");
  revalidatePath("/packs");

  return {
    tenantId,
    workspaceSlug: result.firstWorkspaceSlug,
    requiresMfa: result.requiresMfa === true,
  };
}

// Resolve the acting session/workspace identifiers from context, session, and
// cookies (in that precedence order).
async function resolveActorSwitchScope() {
  const cookieStore = await cookies();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  const workspaceContext = await getWorkspaceContext().catch(swallow("getWorkspaceContext", null));
  return {
    cookieStore,
    session,
    workspaceId: workspaceContext?.workspaceId ?? cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value,
    tenantId:
      workspaceContext?.tenantId ??
      session?.tenantId ??
      cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ??
      "",
    principalId: session?.principalId ?? "",
    sessionId: cookieStore.get(SESSION_COOKIE)?.value ?? session?.sessionId,
  };
}

export async function setActiveActor(
  _prev: ActorSwitchState,
  formData: FormData,
): Promise<ActorSwitchState> {
  const actorId = String(formData.get("actorId") ?? "").trim();
  if (!actorId) return { error: "Actor is required." };

  const { cookieStore, session, workspaceId, tenantId, principalId, sessionId } =
    await resolveActorSwitchScope();

  const result = await switchActorService({
    actorId,
    currentPrincipalId: principalId,
    workspaceId,
    tenantId,
    sessionId,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  const ttlSeconds = sessionTtlHours() * 60 * 60;
  const guardToken = await createSessionGuardToken({
    sid: sessionId ?? "",
    tid: tenantId,
    pid: actorId,
    sub: result.actorSubject,
    mfaVerified: session?.mfaVerified ?? true,
    ttlSeconds,
  });
  cookieStore.set(SESSION_GUARD_COOKIE, guardToken, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds,
  });

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/evidence");
  revalidatePath("/agents");
  revalidatePath("/compliance");
  revalidatePath("/packs");

  return { actorId };
}
