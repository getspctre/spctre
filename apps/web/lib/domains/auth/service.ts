import {
  deletePrincipalPasskey,
  renamePasskey as repoRenamePasskey,
  deletePrincipalMfaEnrollment,
  listPrincipalPasskeys,
  listMfaEnrollments,
  listRevocationHistory,
  getTenantMfaSettings,
  setTenantMfaPolicy,
  getVerifiedMfaEnrollments,
  updateSmsEnrollmentSecret,
  markSessionMfaVerified,
  type PrincipalMfaEnrollment,
  type PrincipalPasskey,
} from "@/lib/repositories/mfa";
import {
  listLinkedSocialIdentities,
  unlinkSocialIdentity as repoUnlinkSocialIdentity,
  ensureLocalDevTenantWorkspace,
  upsertLocalDevPrincipal,
} from "@/lib/repositories/auth/principal";
import {
  listPrincipalSessions,
  revokeSessionAndRecord,
  ensureAuthDemoTenant,
  getPrincipalForLogin,
  getPrimaryWorkspaceIdForTenant,
} from "@/lib/repositories/auth/session";
import { countUnusedRecoveryCodes } from "@/lib/repositories/auth/recovery";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import {
  listIdentityProviders,
  upsertSamlIdentityProvider,
  upsertOidcIdentityProvider,
  deleteIdentityProviderById,
  countIdentityProvidersByType,
  setTenantAuthFlag,
  type IdentityProviderSummary,
} from "@/lib/repositories/identity-providers";
import { ensureDefaultPublishedPolicyPack } from "@/lib/repositories/default-policy";
import { upsertLocalDevWorkspaceGrant } from "@/lib/repositories/auth/grants";
import { listActiveApiKeys, revokeApiKey, revokeServiceTokenAndRefresh } from "@/lib/repositories/auth/service-keys";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { recordConversionTelemetry } from "@/lib/repositories/onboarding/telemetry";

export type { IdentityProviderSummary, PrincipalMfaEnrollment, PrincipalPasskey };

export interface AccountPageModel {
  passkeys: Awaited<ReturnType<typeof listPrincipalPasskeys>>;
  enrollments: Awaited<ReturnType<typeof listMfaEnrollments>>;
  unusedRecoveryCodes: number;
  linkedIdentities: Awaited<ReturnType<typeof listLinkedSocialIdentities>>;
  activeSessions: Awaited<ReturnType<typeof listPrincipalSessions>>;
}

export async function getAccountPageModel(
  principalId: string,
  tenantId: string
): Promise<AccountPageModel> {
  if (!isDatabaseConfigured()) {
    return {
      passkeys: [],
      enrollments: [],
      unusedRecoveryCodes: 0,
      linkedIdentities: [],
      activeSessions: [],
    };
  }

  const [passkeys, enrollments, unusedRecoveryCodes, linkedIdentities, activeSessions] = await Promise.all([
    listPrincipalPasskeys(principalId, tenantId).catch(() => []),
    listMfaEnrollments(principalId, tenantId).catch(() => []),
    countUnusedRecoveryCodes({ principalId, tenantId }).catch(() => 0),
    listLinkedSocialIdentities({ principalId, tenantId }).catch(() => []),
    listPrincipalSessions({ principalId, tenantId }).catch(() => []),
  ]);

  return {
    passkeys,
    enrollments,
    unusedRecoveryCodes,
    linkedIdentities,
    activeSessions,
  };
}

export async function listPrincipalMfaMethods(params: {
  principalId: string;
  tenantId: string;
}) {
  return listMfaEnrollments(params.principalId, params.tenantId);
}

export async function listServiceKeys(params: {
  tenantId: string;
  workspaceId: string;
}) {
  return listActiveApiKeys(params.tenantId, params.workspaceId);
}

export async function revokeServiceKeyById(params: {
  keyId: string;
  tenantId: string;
  workspaceId: string;
}) {
  return revokeApiKey(params);
}

export async function revokeBearerServiceToken(tokenId: string) {
  return revokeServiceTokenAndRefresh(tokenId);
}

export async function listTokenRevocations(params: {
  tenantId: string;
  workspaceId: string;
  limit: number;
}) {
  return listRevocationHistory(params.tenantId, params.workspaceId, params.limit);
}

export async function recordAuthOperation(params: Parameters<typeof appendOperationsLog>[0]) {
  return appendOperationsLog(params);
}

export {
  consumeRecoveryCode,
  findPrincipalByEmail,
  generateRecoveryCodes,
} from "@/lib/repositories/auth/recovery";
export {
  createSmsEnrollment,
  createTotpEnrollment,
  deletePrincipalMfaEnrollment,
  getLatestVerifiedTotpSecret,
  getPendingTotpEnrollmentSecret,
  getSmsEnrollment,
  getVerifiedMfaEnrollments,
  getVerifiedSmsEnrollment,
  getPasskeyByCredentialId,
  isSmsCooldownActive,
  markSmsEnrollmentVerified,
  markSessionMfaVerified,
  markTotpEnrollmentVerified,
  recordPasskeyAuthentication,
  updateSmsEnrollmentSecret,
  upsertPasskeyCredential,
} from "@/lib/repositories/mfa";
export type { StoredPasskeyCredential } from "@/lib/repositories/mfa";
export {
  consumeWebauthnChallenge,
  saveWebauthnChallenge,
} from "@/lib/repositories/auth/webauthn-challenge";
export type { WebauthnChallengePurpose } from "@/lib/repositories/auth/webauthn-challenge";
export {
  ensureAuthDemoTenant,
  getPrincipalForLogin,
  getPrimaryWorkspaceIdForTenant,
  getTenantRequireMfa,
  isAuthDatabaseConfigured,
  resolveTenantIdOrDemo,
} from "@/lib/repositories/auth/session";
export { ensurePrincipalPermissionGrant } from "@/lib/repositories/auth/grants";
export {
  findUserPrincipalIdByIdentifier,
  getPrincipalSubject,
  linkSocialIdentity,
  upsertOidcPrincipal,
  upsertPrincipalExternalIdentity,
  upsertSocialPrincipal,
} from "@/lib/repositories/auth/principal";

export async function createLocalDevSignup(params: {
  displayName: string;
  email: string;
}): Promise<{ ok: true } | { error: "database_required" | "create_failed" }> {
  if (!isDatabaseConfigured()) return { error: "database_required" };

  await ensureAuthDemoTenant();

  const localWorkspace = await ensureLocalDevTenantWorkspace({
    email: params.email,
    displayName: params.displayName,
  });
  if (!localWorkspace) return { error: "create_failed" };

  const principalId = await upsertLocalDevPrincipal({
    tenantId: localWorkspace.tenantId,
    email: params.email,
    displayName: params.displayName,
  });
  if (!principalId) return { error: "create_failed" };

  await upsertLocalDevWorkspaceGrant({
    tenantId: localWorkspace.tenantId,
    principalId,
    workspaceId: localWorkspace.workspaceId,
  });

  await ensureDefaultPublishedPolicyPack({
    tenantId: localWorkspace.tenantId,
    workspaceId: localWorkspace.workspaceId,
    actorId: principalId,
  });

  await recordConversionTelemetry(localWorkspace.tenantId, "SIGNUP_COMPLETED", {
    signupMethod: "local",
  }).catch(() => {});

  return { ok: true };
}

export async function deletePasskey(params: {
  passkeyId: string;
  tenantId: string;
  principalId: string;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await deletePrincipalPasskey(params);
  return { ok: true };
}

export async function renamePasskey(params: {
  passkeyId: string;
  tenantId: string;
  principalId: string;
  name: string;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await repoRenamePasskey(params);
  return { ok: true };
}

export async function deleteMfaEnrollment(params: {
  enrollmentId: string;
  tenantId: string;
  principalId: string;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await deletePrincipalMfaEnrollment(params);
  return { ok: true };
}

export async function unlinkSocialIdentity(params: {
  principalId: string;
  tenantId: string;
  provider: "GOOGLE" | "GITHUB";
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };

  // Server-side guard: prevent removing last authentication method
  const [passkeys, identities] = await Promise.all([
    listPrincipalPasskeys(params.principalId, params.tenantId),
    listLinkedSocialIdentities({ principalId: params.principalId, tenantId: params.tenantId }).catch(() => []),
  ]);
  const remainingIdentities = identities.filter((i) => i.provider !== params.provider);
  if (passkeys.length === 0 && remainingIdentities.length === 0) {
    return { error: "Cannot remove the last authentication method." };
  }

  await repoUnlinkSocialIdentity(params);
  return { ok: true };
}

export async function revokeSession(params: {
  sessionId: string;
  currentSessionId: string;
  tenantId: string;
  principalId: string;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  if (params.sessionId === params.currentSessionId) {
    return { error: "Cannot revoke active session" };
  }

  await revokeSessionAndRecord({
    sessionId: params.sessionId,
    tenantId: params.tenantId,
    principalId: params.principalId,
    actorId: params.principalId,
    source: "LOCAL",
  });
  return { ok: true };
}

export interface AdminAuthPageModel {
  providers: Awaited<ReturnType<typeof listIdentityProviders>>;
  tenantMfa: { requireMfa: boolean; mfaGraceDays: number };
}

export async function getAdminAuthPageModel(tenantId: string): Promise<AdminAuthPageModel> {
  if (!isDatabaseConfigured()) {
    return {
      providers: [],
      tenantMfa: { requireMfa: false, mfaGraceDays: 7 },
    };
  }

  const [providers, tenantMfa] = await Promise.all([
    listIdentityProviders(tenantId).catch(() => []),
    getTenantMfaSettings(tenantId).catch(() => ({ requireMfa: false, mfaGraceDays: 7 })),
  ]);

  return {
    providers,
    tenantMfa,
  };
}

export async function saveSamlIdentityProvider(params: {
  tenantId: string;
  providerId: string;
  name: string;
  issuer: string;
  samlEntryPoint: string;
  samlCert: string | null;
  updateCert: boolean;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await upsertSamlIdentityProvider(params);
  return { ok: true };
}

export async function saveOidcIdentityProvider(params: {
  tenantId: string;
  providerId: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  metadataUrl: string | null;
  scope: string;
  updateSecret: boolean;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await upsertOidcIdentityProvider(params);
  return { ok: true };
}

export async function deleteIdentityProvider(params: {
  tenantId: string;
  providerId: string;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  if (!params.providerId) return { error: "Provider ID is required." };

  const deletedType = await deleteIdentityProviderById({
    tenantId: params.tenantId,
    providerId: params.providerId,
  });

  if (deletedType) {
    const remaining = await countIdentityProvidersByType({
      tenantId: params.tenantId,
      providerType: deletedType,
    });
    const hasType = remaining > 0;

    await setTenantAuthFlag({
      tenantId: params.tenantId,
      flag: deletedType === "SAML" ? "saml_enabled" : "oidc_enabled",
      value: hasType,
    });
  }

  return { ok: true };
}

export async function updateTenantMfaSettings(params: {
  tenantId: string;
  requireMfa: boolean;
  mfaGraceDays: number;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await setTenantMfaPolicy(params);
  return { ok: true };
}

export async function bootstrapDemoTenant(): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  await ensureAuthDemoTenant();
  return { ok: true };
}

export async function authenticatePrincipalForLogin(principalId: string) {
  if (!isDatabaseConfigured()) return null;
  return getPrincipalForLogin(principalId);
}

export async function getPrimaryWorkspaceId(tenantId: string): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  return getPrimaryWorkspaceIdForTenant(tenantId);
}

export async function provisionDefaultPolicyPackIfNeeded(params: {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  requireMfa: boolean;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const { DEMO_TENANT_ID } = await import("@/lib/demo");
  if (params.tenantId !== DEMO_TENANT_ID && params.workspaceId && !params.requireMfa) {
    await ensureDefaultPublishedPolicyPack({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
    });
  }
}

// Verify the code against each SMS enrollment, tracking attempt counts in the
// stored enrollment state. Returns true on the first successful match.
async function verifySmsEnrollments(
  enrollments: Awaited<ReturnType<typeof getVerifiedMfaEnrollments>>,
  params: { tenantId: string; principalId: string; code: string }
): Promise<boolean> {
  const { verifyFirebasePhoneAuth } = await import("@/lib/platform/sms");
  for (const enrollment of enrollments) {
    if (enrollment.mfa_type !== "SMS") continue;

    let state: { sessionInfo: string; expiresAt: string; attempts: number };
    try {
      state = JSON.parse(enrollment.secret_enc);
    } catch {
      // Tolerate corrupt or legacy enrollment rows: skipping one SMS
      // enrollment must not block verification against the others.
      continue;
    }

    if (new Date() > new Date(state.expiresAt)) continue;
    if (state.attempts >= 3) continue;

    let isValid = false;
    if (state.sessionInfo) {
      isValid = await verifyFirebasePhoneAuth(state.sessionInfo, params.code);
    }

    if (isValid) {
      await updateSmsEnrollmentSecret({
        enrollmentId: enrollment.id,
        tenantId: params.tenantId,
        principalId: params.principalId,
        secretEnc: JSON.stringify({ ...state, sessionInfo: "" }),
      });
      return true;
    }
    await updateSmsEnrollmentSecret({
      enrollmentId: enrollment.id,
      tenantId: params.tenantId,
      principalId: params.principalId,
      secretEnc: JSON.stringify({ ...state, attempts: state.attempts + 1 }),
    });
  }
  return false;
}

export async function verifyMfaLoginCode(params: {
  sessionId: string;
  tenantId: string;
  principalId: string;
  code: string;
  factor: "totp" | "sms" | null;
}): Promise<{ ok: boolean } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  if (!/^\d{6}$/.test(params.code)) {
    return { error: "Enter a valid 6-digit code." };
  }

  const enrollments = await getVerifiedMfaEnrollments({
    tenantId: params.tenantId,
    principalId: params.principalId,
  });

  if (!enrollments.length) {
    return { error: "No verified MFA enrollment was found for this account." };
  }

  const hasTotpEnrollment = enrollments.some((e) => e.mfa_type === "TOTP");
  let verified = false;

  const { verifyTotpCode } = await import("@/lib/totp");

  if (params.factor !== "sms") {
    for (const enrollment of enrollments) {
      if (enrollment.mfa_type !== "TOTP") continue;
      if (verifyTotpCode({ code: params.code, secretBase32: enrollment.secret_enc })) {
        verified = true;
        break;
      }
    }
  }

  const shouldTrySms = params.factor === "sms" || (params.factor === null && !hasTotpEnrollment);

  if (!verified && shouldTrySms) {
    const { getSpctrePlan } = await import("@/lib/feature-flags-server");
    if (getSpctrePlan() !== "oss") {
      verified = await verifySmsEnrollments(enrollments, params);
    }
  }

  if (!verified) {
    return { error: "Invalid MFA code." };
  }

  await markSessionMfaVerified({
    sessionId: params.sessionId,
    tenantId: params.tenantId,
  });

  return { ok: true };
}
