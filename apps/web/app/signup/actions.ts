"use server";

import { redirect } from "next/navigation";
import { createLocalDevSignup } from "@/lib/domains/auth/service";

function localSignupEnabled(): boolean {
  return process.env.LOCAL_SIGNUP_ENABLED === "true";
}

export async function localDevSignup(formData: FormData): Promise<void> {
  if (!localSignupEnabled()) {
    redirect("/login?error=local_signup_disabled");
  }
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const next = String(formData.get("next") ?? "").trim();
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!displayName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect(`/signup?error=invalid_input${nextQuery}`);
  }

  const result = await createLocalDevSignup({ email, displayName });
  if ("error" in result) {
    redirect(`/signup?error=${result.error}${nextQuery}`);
  }

  redirect(`/login?ok=local_signup_created${nextQuery}`);
}
