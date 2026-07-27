"use server";

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth-session";
import { approveCliOnboardingRequest } from "@/lib/onboarding";

export async function approveCliOnboarding(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) redirect("/onboarding/cli/approve?error=Missing%20approval%20code.");

  const session = await getAuthSession().catch(() => null);
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/onboarding/cli/approve?code=${code}`)}`);
  }

  const result = await approveCliOnboardingRequest({ code, session });
  if (!result.ok) {
    redirect(`/onboarding/cli/approve?code=${encodeURIComponent(code)}&error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/onboarding/cli/approve?code=${encodeURIComponent(code)}&approved=1&workspace=${encodeURIComponent(result.workspaceSlug)}`);
}
