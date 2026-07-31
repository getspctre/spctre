"use server";

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth-session";
import { approveDeviceOnboarding } from "@/lib/onboarding";
import { swallow } from "@/lib/platform/swallow";

export async function approveDevice(formData: FormData): Promise<void> {
  const userCode = String(formData.get("user_code") ?? "").trim().toUpperCase();
  if (!userCode) redirect("/auth/device?errorCode=missing_code");

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/auth/device?user_code=${userCode}`)}`);
  }

  const result = await approveDeviceOnboarding({ userCode, session });
  if (!result.ok) {
    redirect(`/auth/device?error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/auth/device?approved=1&workspace=${encodeURIComponent(result.workspaceSlug)}`);
}
