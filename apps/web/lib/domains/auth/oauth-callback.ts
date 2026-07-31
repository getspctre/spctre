import { NextResponse } from "next/server";
import { createAuthSession, getAuthSession } from "@/lib/auth-session";
import { setControlPlaneSessionCookies } from "@/lib/auth-session-cookies";
import {
  getPrimaryWorkspaceIdForTenant,
  getTenantRequireMfa,
  isAuthDatabaseConfigured,
  linkSocialIdentity,
  upsertSocialPrincipal,
} from "@/lib/domains/auth/service";
import { swallow } from "@/lib/platform/swallow";

type SocialProvider = "GITHUB" | "GOOGLE";

export interface OAuthCallbackValidation {
  code: string;
  safeNext: string;
  clientId: string;
  clientSecret: string;
}

export interface OAuthIdentity {
  provider: SocialProvider;
  subject: string;
  email: string;
  displayName: string;
}

export function loginRedirect(request: Request, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
}

export function validateOAuthCallback(
  request: Request,
  params: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    notConfiguredError: string;
    stateCookie: string;
  }
): OAuthCallbackValidation | NextResponse {
  const clientId = params.clientId?.trim();
  const clientSecret = params.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    return loginRedirect(request, params.notConfiguredError);
  }
  if (!isAuthDatabaseConfigured()) {
    return loginRedirect(request, "database_required");
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return loginRedirect(request, error);
  }

  const code = url.searchParams.get("code")?.trim();
  const stateParam = url.searchParams.get("state")?.trim() ?? "";
  if (!code) {
    return loginRedirect(request, "missing_code");
  }

  const [stateValue, encodedNext] = stateParam.split(":");
  const safeNext = encodedNext ? decodeURIComponent(encodedNext) : "/";

  const cookieHeader = request.headers.get("cookie") ?? "";
  const stateCookie = cookieHeader.match(new RegExp(`(?:^|;\\s*)${params.stateCookie}=([^;]+)`))?.[1] ?? "";

  if (!stateValue || !stateCookie || stateValue !== stateCookie) {
    return loginRedirect(request, "invalid_state");
  }

  return { code, safeNext, clientId, clientSecret };
}

async function linkOAuthIdentityToSession(params: {
  request: Request;
  session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;
  identity: OAuthIdentity;
  stateCookie: string;
  logPrefix: string;
  safeNext: string;
}): Promise<NextResponse> {
  if (params.session.requireMfa && !params.session.mfaVerified) {
    return loginRedirect(params.request, "mfa_required_to_link");
  }

  await linkSocialIdentity({
    principalId: params.session.principalId,
    tenantId: params.session.tenantId,
    provider: params.identity.provider,
    providerSubject: params.identity.subject,
    providerEmail: params.identity.email,
  }).catch((err) => {
    console.error(`${params.logPrefix} link social identity error:`, err);
  });

  const response = NextResponse.redirect(
    new URL(params.safeNext.startsWith("/") ? params.safeNext : "/account", params.request.url)
  );
  response.cookies.delete(params.stateCookie);
  return response;
}

export async function finalizeOAuthCallback(params: {
  request: Request;
  identity: OAuthIdentity;
  stateCookie: string;
  logPrefix: string;
  safeNext: string;
}): Promise<NextResponse> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (session) {
    return linkOAuthIdentityToSession({
      request: params.request,
      session,
      identity: params.identity,
      stateCookie: params.stateCookie,
      logPrefix: params.logPrefix,
      safeNext: params.safeNext,
    });
  }

  const result = await upsertSocialPrincipal({
    provider: params.identity.provider,
    subject: params.identity.subject,
    email: params.identity.email,
    displayName: params.identity.displayName,
  }).catch(swallow("upsertSocialPrincipal", null));

  if (!result) {
    return loginRedirect(params.request, "database_required");
  }

  const { principalId, tenantId, workspaceId } = result;

  const requireMfa = (await getTenantRequireMfa(tenantId)) ?? false;
  const mfaVerified = !requireMfa;
  const sessionId = await createAuthSession({
    principalId,
    tenantId,
    authMethod: "SESSION",
    mfaVerifiedAt: mfaVerified ? new Date().toISOString() : null,
  });

  const finalWorkspaceId = workspaceId || (await getPrimaryWorkspaceIdForTenant(tenantId)) || "";

  const redirectTarget = mfaVerified
    ? params.safeNext.startsWith("/")
      ? params.safeNext
      : "/"
    : `/login?mfa=required${
        params.safeNext && params.safeNext.startsWith("/") ? `&next=${encodeURIComponent(params.safeNext)}` : ""
      }`;
  const response = NextResponse.redirect(new URL(redirectTarget, params.request.url));
  response.cookies.delete(params.stateCookie);
  await setControlPlaneSessionCookies({
    response,
    sessionId,
    tenantId,
    workspaceId: finalWorkspaceId,
    principalId,
    subject: `${params.identity.provider.toLowerCase()}:${params.identity.subject}`,
    mfaVerified,
  });

  return response;
}
