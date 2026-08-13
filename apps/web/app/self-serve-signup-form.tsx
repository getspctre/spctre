"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Signup offered inline wherever the CLI sends an operator to authorize.
 *
 * Both entry points — the device-code page `spctre cloud login` opens and the
 * approval page `spctre init` opens — otherwise dead-end a visitor with no
 * account at a sign-in link. They arrive from a terminal holding a code that
 * expires, so sending them elsewhere to register costs them that code;
 * `returnTo` carries them back to the authorization they interrupted.
 */
export function SelfServeSignupForm({ returnTo }: { returnTo: string }) {
  const t = useTranslations("auth.self_serve_signup");
  const [state, setState] = useState<"idle" | "submitting" | "sent" | "error">("idle");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/onboarding/self-serve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          displayName: form.get("displayName"),
          returnTo,
        }),
      });
      setState(response.ok ? "sent" : "error");
    } catch (error) {
      // The operator sees the error state; the console keeps the cause, which
      // is the only record of a network failure that never reached the server.
      console.error("[self-serve-signup] request failed", error);
      setState("error");
    }
  }

  // The same confirmation regardless of whether the address already had an
  // account — the API is deliberately silent on that, and saying more here
  // would reintroduce the oracle it avoids.
  if (state === "sent") {
    return (
      <div className="emptyState">
        <h3>{t("sent_title")}</h3>
        <p className="meta">{t("sent_description")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "10px" }}>
      <p className="meta">{t("prompt")}</p>
      <label>
        <span>{t("name")}</span>
        <input className="input" name="displayName" required />
      </label>
      <label>
        <span>{t("email")}</span>
        <input className="input" name="email" type="email" required />
      </label>
      <button className="button buttonPrimary" type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? t("submitting") : t("submit")}
      </button>
      {state === "error" ? <p className="meta workspaceError">{t("error")}</p> : null}
    </form>
  );
}
