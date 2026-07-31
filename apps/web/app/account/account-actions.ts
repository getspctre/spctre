"use server";

import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import {
  deletePasskey,
  renamePasskey,
  deleteMfaEnrollment,
  unlinkSocialIdentity,
  revokeSession,
} from "@/lib/domains/auth/service";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

export async function deletePasskeyForm(formData: FormData): Promise<void> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return;

  const passkeyId = String(formData.get("passkeyId") ?? "").trim();
  if (!passkeyId) return;

  await deletePasskey({
    passkeyId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  revalidatePath("/account");
}
export async function renamePasskeyForm(formData: FormData): Promise<void> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return;

  const passkeyId = String(formData.get("passkeyId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!passkeyId) return;

  await renamePasskey({
    passkeyId,
    tenantId: session.tenantId,
    principalId: session.principalId,
    name,
  });

  revalidatePath("/account");
}

export async function deleteMfaEnrollmentForm(formData: FormData): Promise<void> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return;

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  if (!enrollmentId) return;

  await deleteMfaEnrollment({
    enrollmentId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  revalidatePath("/account");
}

export async function unlinkSocialIdentityForm(formData: FormData): Promise<void> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return;

  const provider = String(formData.get("provider") ?? "").toUpperCase() as "GOOGLE" | "GITHUB";
  if (provider !== "GOOGLE" && provider !== "GITHUB") return;

  await unlinkSocialIdentity({
    principalId: session.principalId,
    tenantId: session.tenantId,
    provider,
  });

  revalidatePath("/account");
}

export type RevokeSessionState = { errorCode: "demo_unavailable" } | null;

export async function revokeSessionForm(
  _prevState: RevokeSessionState,
  formData: FormData
): Promise<RevokeSessionState> {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return null;

  if (isDemoTenant(session.tenantId)) {
    return { errorCode: "demo_unavailable" };
  }

  const targetSessionId = String(formData.get("sessionId") ?? "").trim();
  if (!targetSessionId) return null;

  await revokeSession({
    sessionId: targetSessionId,
    currentSessionId: session.sessionId,
    tenantId: session.tenantId,
    principalId: session.principalId,
  });

  revalidatePath("/account");
  return null;
}
