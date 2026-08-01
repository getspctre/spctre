"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { deleteMfaEnrollmentForm } from "./account-actions";
import type { PrincipalMfaEnrollment } from "@/lib/domains/auth/service";

interface TotpSectionProps {
  existingEnrollments: PrincipalMfaEnrollment[];
}

interface TotpStartResponse {
  enrollmentId: string;
  secret: string;
  otpauthUrl: string;
}

type TotpStatus = "idle" | "enrolling" | "done";

export function TotpSection({ existingEnrollments }: TotpSectionProps) {
  const t = useTranslations("account.totp");
  const [status, setStatus] = useState<TotpStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnrollment() {
    setError(null);

    setBusy(true);
    try { const res = await fetch("/api/auth/mfa/enroll-totp/start", {
      method: "POST",
      headers: { "content-type": "application/json" }
    });

    const data = (await res.json().catch(() => null)) as TotpStartResponse | { error?: string } | null;
    if (!res.ok || !data || !("enrollmentId" in data)) {
      setError((data && "error" in data && data.error) || t("errors.start"));
      return;
    }

    setEnrollmentId(data.enrollmentId);
    setSecret(data.secret);
    setOtpauthUrl(data.otpauthUrl);
    setStatus("enrolling");
    } catch { setError(t("errors.start")); } finally { setBusy(false); }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError(t("errors.invalid_code"));
      return;
    }

    setBusy(true);
    try { const res = await fetch("/api/auth/mfa/enroll-totp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId, code: normalizedCode })
    });

    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !data?.ok) {
      setError(data?.error || t("errors.verify"));
      return;
    }

    setStatus("done");
    window.location.reload();
    } catch { setError(t("errors.verify")); } finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">{t("description")}</p>
      </div>

      {status === "idle" ? (
        <button className="button buttonPrimary accountAction" type="button" onClick={startEnrollment} disabled={busy}>
          {t("enroll")}
        </button>
      ) : null}

      {status === "enrolling" ? (
        <div style={{ display: "grid", gap: "10px" }}>
          <p className="meta">{t("secret")}</p>
          <input className="input" readOnly value={secret} />
          <p className="meta">{t("otpauth_url")}</p>
          <textarea className="codearea" readOnly value={otpauthUrl} rows={3} />

          <form onSubmit={verifyEnrollment} style={{ display: "grid", gap: "10px" }}>
            <label htmlFor="totpCode">{t("code_label")}</label>
            <input
              id="totpCode"
              className="input"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              placeholder="123456"
              required
            />
            <button className="button buttonPrimary accountAction" type="submit" disabled={busy}>
              {t("verify")}
            </button>
          </form>
        </div>
      ) : null}

      {status === "done" ? <p className="meta">{t("verified")}</p> : null}
      {error ? <p className="meta workspaceError" role="alert">{error}</p> : null}

      <div style={{ display: "grid", gap: "10px" }}>
        <h3>{t("verified_enrollments")}</h3>
        {existingEnrollments.length ? (
          existingEnrollments.map((enrollment) => (
            <article className="row" key={enrollment.id}>
              <div className="rowHeader">
                <h3>{enrollment.mfaType}</h3>
                <span className="pill pillAllow">{t("verified_badge")}</span>
              </div>
              <p className="meta">
                {t("verified_at", { date: new Date(enrollment.verifiedAt ?? enrollment.createdAt).toLocaleString() })}
              </p>
              <form action={deleteMfaEnrollmentForm} onSubmit={(event) => { if (!window.confirm(t("remove_confirm", { name: enrollment.mfaType }))) event.preventDefault(); }}>
                <input type="hidden" name="enrollmentId" value={enrollment.id} />
                <button className="button" type="submit">
                  {t("remove")}
                </button>
              </form>
            </article>
          ))
        ) : (
          <p className="meta">{t("empty")}</p>
        )}
      </div>
    </section>
  );
}
