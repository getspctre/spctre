"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getRecaptchaToken } from "@/lib/platform/recaptcha";
import { errorText } from "@/lib/error-message";

export function SmsMfaTrigger() {
  const t = useTranslations("auth.login.sms_mfa");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function triggerOtp() {
    setStatus("sending");
    setError(null);
    try {
      const recaptchaToken = await getRecaptchaToken();
      const res = await fetch("/api/auth/mfa/sms/send-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recaptchaToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || t("errors.send_failed"));
      }
      setStatus("sent");
    } catch (err) {
      setError(errorText(err) || t("errors.unknown"));
      setStatus("error");
    }
  }

  return (
    <div style={{ display: "grid", gap: "6px", marginBlockEnd: "12px" }}>
      {status === "sent" ? <input type="hidden" name="method" value="sms" /> : null}
      <button className="button" type="button" onClick={triggerOtp} disabled={status === "sending"}>
        {status === "idle" && t("send")}
        {status === "sending" && t("sending")}
        {status === "sent" && t("sent")}
        {status === "error" && t("retry")}
      </button>
      {error && (
        <p
          className="meta workspaceError"
          role="alert"
          style={{ color: "var(--red)", fontSize: "12px", margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
