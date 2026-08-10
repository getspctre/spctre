"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/cookies";
import { DEMO_PRINCIPAL_IDS } from "@/lib/demo";
import {
  bootstrapDemoTenant,
  authenticatePrincipalForLogin,
  getPrimaryWorkspaceId,
  verifyMfaLoginCode,
} from "@/lib/domains/auth/service";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "@/lib/demo";
import {
  SESSION_COOKIE,
  createAuthSession,
  getAuthSession,
  revokeAuthSession,
  sessionTtlHours,
} from "@/lib/auth-session";
import { createSessionGuardToken, SESSION_GUARD_COOKIE } from "@/lib/session-guard";
import { isConfiguredUserLoginEnabled } from "@/lib/auth-login-modes";
import { swallow } from "@/lib/platform/swallow";

export type LoginState = { error: string; ok?: never } | { ok: true; error?: never } | null;

type MfaVerifyState = { error: string; ok?: never } | { ok: true; error?: never } | null;

export async function launchDemoCloud(): Promise<void> {
  const bootstrap = await bootstrapDemoTenant();
  if ("error" in bootstrap) redirect("/login?error=demo_unavailable");

  const principal = await authenticatePrincipalForLogin(DEMO_PRINCIPAL_IDS.owner);
  if (!principal || principal.tenant_id !== DEMO_TENANT_ID) {
    redirect("/login?error=demo_unavailable");
  }

  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent") ?? undefined;
  const ipAddress =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    undefined;

  const sessionId = await createAuthSession({
    principalId: principal.id,
    tenantId: DEMO_TENANT_ID,
    authMethod: "SESSION",
    mfaVerifiedAt: new Date().toISOString(),
    userAgent,
    ipAddress,
  });
  const ttlSeconds = sessionTtlHours() * 60 * 60;
  const guardToken = await createSessionGuardToken({
    sid: sessionId,
    tid: DEMO_TENANT_ID,
    pid: principal.id,
    sub: principal.subject,
    mfaVerified: true,
    ttlSeconds,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds,
  });
  cookieStore.set(SESSION_GUARD_COOKIE, guardToken, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds,
  });
  cookieStore.set(ACTIVE_TENANT_COOKIE, DEMO_TENANT_ID, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, DEMO_WORKSPACE_ID, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/");
}

export async function loginWithPrincipal(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!isConfiguredUserLoginEnabled()) {
    return { error: "Configured-user login is disabled." };
  }

  await bootstrapDemoTenant();

  const principalId = String(formData.get("principalId") ?? "").trim();
  if (!principalId) return { error: "Select a user to sign in." };

  const next = String(formData.get("next") ?? "").trim();
  const redirectTarget = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const principal = await authenticatePrincipalForLogin(principalId);
  if (!principal) return { error: "Selected user is not available." };

  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent") ?? undefined;
  const ipAddress =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    undefined;

  const sessionId = await createAuthSession({
    principalId: principal.id,
    tenantId: principal.tenant_id,
    authMethod: "SESSION",
    mfaVerifiedAt: principal.require_mfa ? null : new Date().toISOString(),
    userAgent,
    ipAddress,
  });
  const ttlSeconds = sessionTtlHours() * 60 * 60;
  const guardToken = await createSessionGuardToken({
    sid: sessionId,
    tid: principal.tenant_id,
    pid: principal.id,
    sub: principal.subject,
    mfaVerified: !principal.require_mfa,
    ttlSeconds,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds,
  });
  cookieStore.set(SESSION_GUARD_COOKIE, guardToken, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds,
  });

  const workspaceId = await getPrimaryWorkspaceId(principal.tenant_id);

  cookieStore.set(ACTIVE_TENANT_COOKIE, principal.tenant_id, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId ?? "", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  // The workspace baseline is seeded by createAuthSession above (and, for
  // tenants that still owe MFA, once they verify), so there is nothing to do
  // here.

  if (principal.require_mfa) {
    const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";
    redirect(`/login?mfa=required${nextQuery}`);
  }

  redirect(redirectTarget);
}

export async function loginWithPrincipalForm(formData: FormData): Promise<void> {
  await loginWithPrincipal(null, formData);
}

async function verifyMfaLogin(_prev: MfaVerifyState, formData: FormData): Promise<MfaVerifyState> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Sign in before verifying MFA." };
  if (!session.requireMfa) return { ok: true };
  if (session.mfaVerified) return { ok: true };

  const code = String(formData.get("code") ?? "").trim();
  const next = String(formData.get("next") ?? "").trim();
  const redirectTarget = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const rawMethod = String(formData.get("method") ?? "")
    .trim()
    .toLowerCase();
  const factor: "totp" | "sms" | null =
    rawMethod === "totp" ? "totp" : rawMethod === "sms" ? "sms" : null;

  const result = await verifyMfaLoginCode({
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    principalId: session.principalId,
    code,
    factor,
  });

  if ("error" in result) {
    return { error: result.error };
  }

  const ttlSeconds = sessionTtlHours() * 60 * 60;
  const guardToken = await createSessionGuardToken({
    sid: session.sessionId,
    tid: session.tenantId,
    pid: session.principalId,
    sub: session.subject,
    mfaVerified: true,
    ttlSeconds,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_GUARD_COOKIE, guardToken, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds,
  });

  redirect(redirectTarget);
}

export async function verifyMfaLoginForm(formData: FormData): Promise<void> {
  await verifyMfaLogin(null, formData);
}

export async function logoutControlPlane() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (session?.sessionId) {
    await revokeAuthSession(session.sessionId, session.tenantId).catch(
      swallow("revokeAuthSession", undefined),
    );
  }

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(SESSION_GUARD_COOKIE);
  cookieStore.delete(ACTIVE_WORKSPACE_COOKIE);
  cookieStore.set(ACTIVE_TENANT_COOKIE, DEMO_TENANT_ID, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/login");
}
