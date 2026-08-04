import { cookies } from "next/headers";
import { SESSION_GUARD_COOKIE, verifySessionGuardToken } from "@/lib/session-guard";
import {
  ensureAuthDemoTenant,
  fetchSessionForAuth,
  updateSessionAndPrincipalActivity,
  createSessionRow,
  revokeSessionRow,
  listAllLoginPrincipals as repoListAllLoginPrincipals,
} from "@/lib/repositories/auth/session";

export const SESSION_COOKIE = "spctre_session_id";
const DEFAULT_SESSION_TTL_HOURS = 12;

export interface AuthSession {
  sessionId: string;
  tenantId: string;
  principalId: string;
  displayName: string;
  email: string | null;
  subject: string;
  authMethod: string;
  requireMfa: boolean;
  mfaVerified: boolean;
}

export function sessionTtlHours(): number {
  const raw = Number.parseInt(process.env.SPCTRE_SESSION_TTL_HOURS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_TTL_HOURS;
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const guardToken = cookieStore.get(SESSION_GUARD_COOKIE)?.value;

  if (!sessionId || !guardToken) return null;

  const row = await fetchSessionForAuth(sessionId);
  if (!row) return null;

  const guardClaims = await verifySessionGuardToken(guardToken, sessionId);
  if (!guardClaims) return null;

  if (
    guardClaims.tid !== row.tenant_id ||
    guardClaims.pid !== row.principal_id ||
    guardClaims.sub !== row.subject
  ) {
    return null;
  }

  const mfaVerified = !row.require_mfa || row.mfa_verified_at !== null;
  if (guardClaims.mfa !== mfaVerified) {
    return null;
  }

  await updateSessionAndPrincipalActivity(row.session_id, row.principal_id, row.tenant_id);

  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    displayName: row.display_name,
    email: row.email,
    subject: row.subject,
    authMethod: row.auth_method,
    requireMfa: row.require_mfa,
    mfaVerified,
  };
}

export async function createAuthSession(params: {
  principalId: string;
  tenantId: string;
  authMethod?: "SESSION" | "OIDC" | "SAML" | "API_KEY";
  mfaVerifiedAt?: string | null;
  userAgent?: string;
  ipAddress?: string;
  db?: Parameters<typeof createSessionRow>[1];
}): Promise<string> {
  await ensureAuthDemoTenant();

  const expiresAt = new Date(Date.now() + sessionTtlHours() * 60 * 60 * 1000).toISOString();

  return createSessionRow(
    {
      principalId: params.principalId,
      tenantId: params.tenantId,
      expiresAt,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      authMethod: params.authMethod ?? "SESSION",
      mfaVerifiedAt: params.mfaVerifiedAt,
    },
    params.db,
  );
}

export async function revokeAuthSession(sessionId: string, tenantId: string): Promise<void> {
  if (!sessionId?.trim()) throw new Error("Session ID is required.");
  if (!tenantId?.trim()) throw new Error("Tenant ID is required.");

  await revokeSessionRow(sessionId.trim(), tenantId.trim());
}

export async function listAllLoginPrincipals() {
  return repoListAllLoginPrincipals();
}
