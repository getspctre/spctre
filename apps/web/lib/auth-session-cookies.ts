import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTtlHours } from "./auth-session";
import { createSessionGuardToken, SESSION_GUARD_COOKIE } from "./session-guard";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "./workspace/cookies";

export async function setControlPlaneSessionCookies(params: {
  response: NextResponse;
  sessionId: string;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  subject: string;
  mfaVerified: boolean;
}) {
  const ttlSeconds = sessionTtlHours() * 60 * 60;
  const guardToken = await createSessionGuardToken({
    sid: params.sessionId,
    tid: params.tenantId,
    pid: params.principalId,
    sub: params.subject,
    mfaVerified: params.mfaVerified,
    ttlSeconds
  });

  const cookieOptions = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlSeconds
  };

  params.response.cookies.set(SESSION_COOKIE, params.sessionId, cookieOptions);
  params.response.cookies.set(SESSION_GUARD_COOKIE, guardToken, cookieOptions);
  params.response.cookies.set(ACTIVE_TENANT_COOKIE, params.tenantId, cookieOptions);
  params.response.cookies.set(ACTIVE_WORKSPACE_COOKIE, params.workspaceId, cookieOptions);
}
