"use server";

import { revalidatePath } from "next/cache";
import { updateTenantMfaSettings as updateTenantMfaSettingsService } from "@/lib/domains/auth/service";
import { requireAdminSession, type AdminAuthActionState } from "./shared-actions";
import { verifyWriteAccess } from "@/lib/demo-guard";

export async function updateTenantMfaSettings(
  _prev: AdminAuthActionState,
  formData: FormData,
): Promise<AdminAuthActionState> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error ?? "Admin permission is required." };

  const writeCheck = verifyWriteAccess(guard.session.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

  const requireMfaValue = String(formData.get("requireMfa") ?? "").toLowerCase();
  const requireMfa =
    requireMfaValue === "on" || requireMfaValue === "true" || requireMfaValue === "1";
  const graceRaw = Number.parseInt(String(formData.get("mfaGraceDays") ?? "7"), 10);
  const mfaGraceDays = Number.isFinite(graceRaw) ? Math.min(Math.max(graceRaw, 0), 365) : 7;

  await updateTenantMfaSettingsService({
    tenantId: guard.session.tenantId,
    requireMfa,
    mfaGraceDays,
  });

  revalidatePath("/admin/auth");
  return { ok: true, messageCode: "updated" };
}
