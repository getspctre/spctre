"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { deletePasskeyForm, renamePasskeyForm } from "./account-actions";
import type { PrincipalPasskey } from "@/lib/domains/auth/service";

interface PasskeySectionProps {
  passkeys: PrincipalPasskey[];
}

interface PasskeyMessages {
  browser_unsupported: string;
  cancelled: string;
  finish_failed: string;
  start_failed: string;
  unknown: string;
}

function PasskeyRow({ passkey }: { passkey: PrincipalPasskey }) {
  const t = useTranslations("account.passkeys");
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(passkey.name ?? "");
  const displayName = passkey.name || t("fallback_name", { suffix: passkey.credentialIdB64.slice(-8) });

  return (
    <article className="row">
      <div className="rowHeader">
        {editing ? (
          <form
            action={renamePasskeyForm}
            onSubmit={() => setEditing(false)}
            style={{ display: "flex", gap: "6px", flex: 1 }}
          >
            <input type="hidden" name="passkeyId" value={passkey.id} />
            <input
              className="input"
              name="name"
              value={nameInput}
              onChange={(e) => setNameInput(e.currentTarget.value)}
              placeholder={t("name_placeholder")}
              maxLength={64}
              autoFocus
              style={{ fontSize: "13px", height: "30px" }}
            />
            <button className="button" type="submit" style={{ height: "30px" }}>{t("save")}</button>
            <button className="button" type="button" onClick={() => setEditing(false)} style={{ height: "30px" }}>
              {t("cancel")}
            </button>
          </form>
        ) : (
          <>
            <h3 style={{ fontSize: "13px" }}>{displayName}</h3>
            <div style={{ display: "flex", gap: "6px" }}>
              <span className="pill">{t("badge")}</span>
              <button
                className="button"
                type="button"
                onClick={() => setEditing(true)}
                style={{ padding: "2px 8px", fontSize: "12px" }}
              >
                {t("rename")}
              </button>
            </div>
          </>
        )}
      </div>
      <p className="meta">{t("created", { date: new Date(passkey.createdAt).toLocaleString() })}</p>
      <p className="meta">
        {t("last_used", { date: passkey.usedAt ? new Date(passkey.usedAt).toLocaleString() : t("never") })}
      </p>
      <form action={deletePasskeyForm} onSubmit={(event) => { if (!window.confirm(`Remove ${displayName}?`)) event.preventDefault(); }}>
        <input type="hidden" name="passkeyId" value={passkey.id} />
        <button className="button" type="submit">{t("remove")}</button>
      </form>
    </article>
  );
}

interface PasskeyRegisterStartResponse {
  options: PublicKeyCredentialCreationOptionsJSON;
}

// Start the server ceremony, create the credential, and finish registration.
// The server verifies the attestation and stores the authenticator's public key;
// the browser never supplies the key. Throws with a user-facing message on any failure.
async function performPasskeyRegistration(messages: PasskeyMessages): Promise<void> {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error(messages.browser_unsupported);
  }

  const startRes = await fetch("/api/auth/passkey/register/start", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  const startData = (await startRes.json().catch(() => null)) as
    | PasskeyRegisterStartResponse
    | { error?: string }
    | null;

  if (!startRes.ok || !startData || !("options" in startData)) {
    throw new Error((startData && "error" in startData && startData.error) || messages.start_failed);
  }

  let registrationResponse;
  try {
    registrationResponse = await startRegistration({ optionsJSON: startData.options });
  } catch {
    throw new Error(messages.cancelled);
  }

  const finishRes = await fetch("/api/auth/passkey/register/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response: registrationResponse })
  });
  const finishData = (await finishRes.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

  if (!finishRes.ok || !finishData?.ok) {
    throw new Error(finishData?.error || messages.finish_failed);
  }
}

export function PasskeySection({ passkeys }: PasskeySectionProps) {
  const t = useTranslations("account.passkeys");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function registerPasskey() {
    setBusy(true);
    setError(null);

    try {
      await performPasskeyRegistration({
        browser_unsupported: t("errors.browser_unsupported"),
        cancelled: t("errors.cancelled"),
        finish_failed: t("errors.finish_failed"),
        start_failed: t("errors.start_failed"),
        unknown: t("errors.unknown"),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.unknown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">{t("description")}</p>
      </div>

      <button className="button buttonPrimary accountAction" type="button" onClick={registerPasskey} disabled={busy}>
        {busy ? t("registering") : t("register")}
      </button>
      {error ? <p className="meta workspaceError" role="alert">{error}</p> : null}

      <div style={{ display: "grid", gap: "10px" }}>
        {passkeys.length ? (
          passkeys.map((passkey) => (
            <PasskeyRow key={passkey.id} passkey={passkey} />
          ))
        ) : (
          <p className="meta">{t("empty")}</p>
        )}
      </div>
    </section>
  );
}
