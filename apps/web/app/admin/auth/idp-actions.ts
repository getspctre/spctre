"use server";

import { revalidatePath } from "next/cache";
import {
  saveOidcIdentityProvider,
  saveSamlIdentityProvider,
  deleteIdentityProvider,
} from "@/lib/domains/auth/service";
import { requireAdminSession, type AdminAuthActionState } from "./shared-actions";
import { verifyWriteAccess } from "@/lib/demo-guard";

export type IdentityProviderMutationState =
  | { ok: true; message?: string; messageCode?: string; error?: never; errorCode?: never }
  | { ok?: never; message?: never; messageCode?: never; error: string; errorCode?: string }
  | null;

interface IdpCommonFields {
  tenantId: string;
  providerId: string;
  name: string;
  issuer: string;
}

// SAML branch: validate and save. Returns an error message when invalid.
async function saveSamlFromForm(
  formData: FormData,
  common: IdpCommonFields,
): Promise<string | null> {
  const samlEntryPoint = String(formData.get("samlEntryPoint") ?? "").trim();
  const samlCertRaw = String(formData.get("samlCert") ?? "").trim();

  if (!samlEntryPoint) {
    return "saml_entry_point_required";
  }
  if (!common.providerId && !samlCertRaw) {
    return "saml_cert_required";
  }

  await saveSamlIdentityProvider({
    ...common,
    samlEntryPoint,
    samlCert: samlCertRaw || null,
    updateCert: samlCertRaw.length > 0,
  });
  return null;
}

// OIDC branch: validate and save. Returns an error message when invalid.
async function saveOidcFromForm(
  formData: FormData,
  common: IdpCommonFields,
): Promise<string | null> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const metadataUrlRaw = String(formData.get("metadataUrl") ?? "").trim();
  const scopeRaw = String(formData.get("scope") ?? "").trim();

  if (!clientId) {
    return "client_id_required";
  }

  await saveOidcIdentityProvider({
    ...common,
    clientId,
    clientSecret: clientSecret || null,
    metadataUrl: metadataUrlRaw || null,
    scope: scopeRaw || "openid profile email",
    updateSecret: clientSecret.length > 0,
  });
  return null;
}

export async function upsertIdentityProvider(
  _prev: AdminAuthActionState,
  formData: FormData,
): Promise<AdminAuthActionState> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error ?? "Admin permission is required." };

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

  const providerId = String(formData.get("providerId") ?? "").trim();
  const providerType = String(formData.get("providerType") ?? "OIDC")
    .trim()
    .toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();

  if (!name || !issuer) {
    return { error: "Name and issuer are required.", errorCode: "name_issuer_required" };
  }

  const common: IdpCommonFields = { tenantId: guard.session.tenantId, providerId, name, issuer };
  const saveError =
    providerType === "SAML"
      ? await saveSamlFromForm(formData, common)
      : await saveOidcFromForm(formData, common);
  if (saveError) return { error: saveError, errorCode: saveError };

  revalidatePath("/admin/auth");
  return { ok: true, messageCode: "saved" };
}

export async function deleteIdentityProviderForm(
  _prev: IdentityProviderMutationState,
  formData: FormData,
): Promise<IdentityProviderMutationState> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error ?? "Admin permission is required." };

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

  const providerId = String(formData.get("providerId") ?? "").trim();
  if (!providerId) return { error: "Identity provider is missing.", errorCode: "missing_provider" };

  await deleteIdentityProvider({ tenantId: guard.session.tenantId, providerId });

  revalidatePath("/admin/auth");
  return { ok: true, messageCode: "removed" };
}
