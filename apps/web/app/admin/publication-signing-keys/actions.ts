"use server";

import { revalidatePath } from "next/cache";
import {
  PublicationSigningKeyChallengeSchema,
  PublicationSigningKeyEnrollSchema,
} from "@spctre/api-contracts";
import { verifyPublicationSigningChallenge } from "@spctre/policy-schema";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { verifyWriteAccess } from "@/lib/demo-guard";
import {
  consumePublicationSigningChallenge,
  createPublicationSigningChallenge,
  revokePublicationSigningKey,
} from "@/lib/repositories/publication-attestations";
import { runWithTenantContext } from "@/lib/tenant-context";
import { getActiveScope } from "@/lib/workspace";
import { reportSwallowedError, swallow } from "@/lib/platform/swallow";

export type SigningKeyActionState =
  | { ok: true; message: string; challengeId?: string; challenge?: string; expiresAt?: string }
  | { ok?: never; error: string }
  | null;

async function requireSigningKeyAdmin() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required." } as const;
  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) return { error: "Workspace context unavailable." } as const;
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin"))
    return { error: "Admin permission is required." } as const;
  if (!verifyWriteAccess(session.tenantId).allowed)
    return { error: "Write access is denied." } as const;
  return { session, ctx } as const;
}

export async function createSigningKeyChallenge(
  _previous: SigningKeyActionState,
  formData: FormData,
): Promise<SigningKeyActionState> {
  const guard = await requireSigningKeyAdmin();
  if ("error" in guard) return { error: guard.error ?? "Permission denied." };
  const parsed = PublicationSigningKeyChallengeSchema.safeParse({
    entityRef: formData.get("entityRef"),
    keyId: formData.get("keyId"),
    publicKey: formData.get("publicKey"),
  });
  if (!parsed.success) return { error: "Enter a stable entity reference, key ID, and public key." };
  try {
    const challenge = await runWithTenantContext(guard.session.tenantId, () =>
      createPublicationSigningChallenge({
        ...parsed.data,
        tenantId: guard.session.tenantId,
        workspaceId: guard.ctx.workspaceId,
      }),
    );
    return {
      ok: true,
      message: "Challenge created. Sign its canonical payload before enrollment.",
      ...challenge,
    };
  } catch (error) {
    reportSwallowedError("createSigningKeyChallenge", error);
    return { error: error instanceof Error ? error.message : "Could not create challenge." };
  }
}

export async function enrollSigningKey(
  _previous: SigningKeyActionState,
  formData: FormData,
): Promise<SigningKeyActionState> {
  const guard = await requireSigningKeyAdmin();
  if ("error" in guard) return { error: guard.error ?? "Permission denied." };
  let proof: unknown;
  try {
    proof = JSON.parse(String(formData.get("proof") ?? ""));
  } catch {
    reportSwallowedError("enrollSigningKey.parseProof", new Error("Invalid proof JSON."));
    return { error: "Proof must be a JSON signed challenge receipt." };
  }
  const parsed = PublicationSigningKeyEnrollSchema.safeParse({
    entityRef: formData.get("entityRef"),
    keyId: formData.get("keyId"),
    publicKey: formData.get("publicKey"),
    challengeId: formData.get("challengeId"),
    replacesKeyId: formData.get("replacesKeyId") || undefined,
    proof,
  });
  if (!parsed.success) return { error: "Enrollment details or ownership proof are invalid." };
  if (
    parsed.data.proof.payload.challengeId !== parsed.data.challengeId ||
    parsed.data.proof.signature.publicKey !== parsed.data.publicKey ||
    !verifyPublicationSigningChallenge(parsed.data.proof).verified
  )
    return { error: "The proof does not bind this challenge and public key." };
  try {
    await runWithTenantContext(guard.session.tenantId, () =>
      consumePublicationSigningChallenge({
        ...parsed.data,
        challenge: parsed.data.proof.payload.challenge,
        tenantId: guard.session.tenantId,
        workspaceId: guard.ctx.workspaceId,
        enrolledBy: guard.session.principalId,
      }),
    );
    revalidatePath("/admin/publication-signing-keys");
    return { ok: true, message: "Signing key enrolled and ownership verified." };
  } catch (error) {
    reportSwallowedError("enrollSigningKey", error);
    return { error: error instanceof Error ? error.message : "Could not enroll signing key." };
  }
}

export async function revokeSigningKey(
  _previous: SigningKeyActionState,
  formData: FormData,
): Promise<SigningKeyActionState> {
  const guard = await requireSigningKeyAdmin();
  if ("error" in guard) return { error: guard.error ?? "Permission denied." };
  const keyId = String(formData.get("keyId") ?? "").trim();
  if (!keyId) return { error: "Signing key is missing." };
  const revoked = await runWithTenantContext(guard.session.tenantId, () =>
    revokePublicationSigningKey({
      tenantId: guard.session.tenantId,
      workspaceId: guard.ctx.workspaceId,
      keyId,
      revokedBy: guard.session.principalId,
      reason: String(formData.get("reason") ?? "").trim() || undefined,
    }),
  );
  if (!revoked) return { error: "Signing key was not found or is already revoked." };
  revalidatePath("/admin/publication-signing-keys");
  return { ok: true, message: "Signing key revoked." };
}
