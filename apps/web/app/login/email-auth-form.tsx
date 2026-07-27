"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toBase64Url, fromBase64Url } from "@/lib/crypto-utils";

interface PasskeyLoginStartResponse {
  challenge: string;
  allowCredentials: string[];
  rpId: string;
}

export function EmailAuthForm() {
  const t = useTranslations("auth.login.email");
  const [email, setEmail] = useState("");
  const [magicStatus, setMagicStatus] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  async function handleMagicLink(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setMagicStatus("busy");
    setPasskeyError(null);

    try {
      const res = await fetch("/api/auth/magic/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setMagicStatus("sent");
      } else {
        setMagicStatus("error");
      }
    } catch {
      setMagicStatus("error");
    }
  }

  async function handlePasskey(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    setMagicStatus("idle");

    try {
      if (!window.PublicKeyCredential || !navigator.credentials?.get) {
        throw new Error(t("errors.browser_unsupported"));
      }

      const startRes = await fetch("/api/auth/passkey/login/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email.trim() }),
      });
      const startData = (await startRes.json().catch(() => null)) as
        | PasskeyLoginStartResponse
        | { error?: string }
        | null;

      if (!startRes.ok || !startData || !("challenge" in startData)) {
        throw new Error((startData && "error" in startData && startData.error) || t("errors.start_passkey"));
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: fromBase64Url(startData.challenge),
          allowCredentials: startData.allowCredentials.map((credentialId) => ({
            id: fromBase64Url(credentialId),
            type: "public-key" as const,
          })),
          rpId: startData.rpId,
          userVerification: "preferred",
          timeout: 30_000,
        },
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeoutId))) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error(t("errors.cancelled"));
      }

      const credentialId = toBase64Url(new Uint8Array(credential.rawId));
      const finishRes = await fetch("/api/auth/passkey/login/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge: startData.challenge,
          credentialId,
        }),
      });
      const finishData = (await finishRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!finishRes.ok || !finishData?.ok) {
        throw new Error(finishData?.error || t("errors.passkey_failed"));
      }

      window.location.href = "/";
    } catch (cause) {
      setPasskeyError(cause instanceof Error ? cause.message : t("errors.passkey_unknown"));
    } finally {
      setPasskeyBusy(false);
    }
  }

  if (magicStatus === "sent") {
    return (
      <p className="loginMessage" style={{ margin: "10px 0" }}>
        {t("magic_sent")}
      </p>
    );
  }

  const isBusy = magicStatus === "busy" || passkeyBusy;

  return (
    <form className="loginForm" onSubmit={(e) => e.preventDefault()}>
      <div className="loginFieldGroup">
        <label className="metadata" htmlFor="login-email">{t("email")}</label>
        <input
          id="login-email"
          className="input"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder={t("email_placeholder")}
          autoComplete="email"
          required
          disabled={isBusy}
        />
      </div>

      <div className="loginFormActions" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "2px" }}>
        <button
          className="button buttonPrimary"
          type="button"
          onClick={handleMagicLink}
          disabled={isBusy || !email.trim()}
        >
          {magicStatus === "busy" ? t("sending_link") : t("magic_link")}
        </button>

        <button
          className="button"
          type="button"
          onClick={handlePasskey}
          disabled={isBusy || !email.trim()}
        >
          {passkeyBusy ? t("verifying") : t("use_passkey")}
        </button>
      </div>

      {magicStatus === "error" ? (
        <p className="loginMessage loginMessageError" style={{ marginTop: "8px" }}>
          {t("errors.magic_link")}
        </p>
      ) : null}

      {passkeyError ? (
        <p className="loginMessage loginMessageError" style={{ marginTop: "8px" }}>
          {passkeyError}
        </p>
      ) : null}
    </form>
  );
}
