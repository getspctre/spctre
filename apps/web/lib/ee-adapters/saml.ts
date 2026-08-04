// OSS stub — EE build replaces this file with a version that delegates to ee/web/saml/adapter.
import { NextResponse } from "next/server";

export async function samlAuthorizeGET(_request: Request): Promise<Response> {
  return NextResponse.json({ error: "SAML is not configured." }, { status: 404 });
}

export async function samlCallbackPOST(_request: Request): Promise<Response> {
  return NextResponse.json({ error: "SAML is not configured." }, { status: 404 });
}

export async function samlMetadataGET(): Promise<Response> {
  return NextResponse.json({ error: "SAML is not configured." }, { status: 404 });
}

export { SESSION_COOKIE, createAuthSession, sessionTtlHours } from "@/lib/auth-session";
export { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/cookies";
export { createSessionGuardToken, SESSION_GUARD_COOKIE } from "@/lib/session-guard";
export { DEMO_TENANT_ID } from "@/lib/demo";
export { ensurePrincipalGrantAndCheckAccess } from "@/lib/repositories/auth/grants";
export {
  upsertSamlPrincipal,
  upsertPrincipalExternalIdentity,
} from "@/lib/repositories/auth/principal";
export {
  saveSamlAuthnRequestId,
  claimSamlAuthnRequestValue,
  releaseSamlAuthnRequestLease,
  finalizeSamlAuthnRequestLease,
} from "@/lib/repositories/auth/saml-request-cache";
export {
  isAuthDatabaseConfigured,
  ensureAuthDemoTenant,
  canBootstrapDemoTenant,
  getPrimaryWorkspaceIdForTenant,
  getTenantRequireMfa,
} from "@/lib/repositories/auth/session";
