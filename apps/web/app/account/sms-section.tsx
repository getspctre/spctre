"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { getRecaptchaToken } from "@/lib/platform/recaptcha";
import { deleteMfaEnrollmentForm } from "./account-actions";
import type { PrincipalMfaEnrollment } from "@/lib/domains/auth/service";

interface SmsSectionProps {
  existingEnrollments: PrincipalMfaEnrollment[];
}

type SmsStatus = "idle" | "sending" | "verifying" | "done";

function maskPhoneNumber(phone: string): string {
  if (!phone) return "";
  if (phone.length <= 4) return phone;
  const last4 = phone.slice(-4);
  const firstPart = phone.slice(0, -4);
  const masked = firstPart.replace(/\d/g, "•");
  return `${masked}${last4}`;
}

export function SmsSection({ existingEnrollments }: SmsSectionProps) {
  const t = useTranslations("account.sms");
  const [status, setStatus] = useState<SmsStatus>("idle");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Check if SMS is already enrolled
  // The table lists all verified enrollments passed to page.tsx
  const smsEnrollments = existingEnrollments.filter((e) => e.mfaType === "SMS");

  async function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("sending");

    try {
      const recaptchaToken = await getRecaptchaToken();
      const res = await fetch("/api/auth/mfa/enroll-sms/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim(), recaptchaToken }),
      });

      const data = (await res.json().catch(() => null)) as { enrollmentId?: string; error?: string } | null;
      if (!res.ok || !data?.enrollmentId) {
        setError(data?.error || t("errors.start"));
        setStatus("idle");
        return;
      }

      setEnrollmentId(data.enrollmentId);
      setStatus("verifying");
    } catch {
      setError(t("errors.unexpected"));
      setStatus("idle");
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError(t("errors.invalid_code"));
      return;
    }

    try {
      const res = await fetch("/api/auth/mfa/enroll-sms/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentId, code: normalizedCode }),
      });

      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error || t("errors.verify"));
        return;
      }

      setStatus("done");
      window.location.reload();
    } catch {
      setError(t("errors.unexpected_verify"));
    }
  }

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">{t("description")}</p>
      </div>

      {smsEnrollments.length === 0 && status === "idle" && (
        <form onSubmit={startEnrollment} style={{ display: "grid", gap: "10px" }}>
          <label htmlFor="phoneNumber">{t("phone_label")}</label>
          <input
            id="phoneNumber"
            className="input"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.currentTarget.value)}
            placeholder="+15551234567"
            required
          />
          <button className="button buttonPrimary accountAction" type="submit">
            {t("send")}
          </button>
        </form>
      )}

      {status === "sending" && <p className="meta">{t("sending")}</p>}

      {status === "verifying" && (
        <form onSubmit={verifyEnrollment} style={{ display: "grid", gap: "10px" }}>
          <p className="meta">{t("sent", { phone: maskPhoneNumber(phoneNumber) })}</p>
          <label htmlFor="smsCode">{t("code_label")}</label>
          <input
            id="smsCode"
            className="input"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            placeholder="123456"
            required
            autoFocus
          />
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="button buttonPrimary accountAction" type="submit">
              {t("verify")}
            </button>
            <button className="button" type="button" onClick={() => setStatus("idle")}>
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {status === "done" && <p className="meta">{t("verified")}</p>}
      {error && <p className="meta workspaceError">{error}</p>}

      <div style={{ display: "grid", gap: "10px" }}>
        {smsEnrollments.length > 0 && (
          <>
            <h3>{t("verified_channels")}</h3>
            {smsEnrollments.map((enrollment) => (
              <article className="row" key={enrollment.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0 }}>
                    {t("channel", { phone: enrollment.phoneNumber ? maskPhoneNumber(enrollment.phoneNumber) : t("channel_fallback") })}
                  </h3>
                  <p className="meta" style={{ margin: 0 }}>
                    {t("verified_at", { date: new Date(enrollment.verifiedAt ?? enrollment.createdAt).toLocaleString() })}
                  </p>
                </div>
                <form action={deleteMfaEnrollmentForm}>
                  <input type="hidden" name="enrollmentId" value={enrollment.id} />
                  <button className="button" type="submit">
                    {t("remove")}
                  </button>
                </form>
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
