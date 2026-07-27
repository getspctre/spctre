"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BrandLogo } from "@/components/brand-logo";
import { KeyRound } from "lucide-react";

export default function RecoverPage() {
  const t = useTranslations("auth.recover");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("busy");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/auth/recovery/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });

      if (res.ok) {
        router.replace("/");
        return;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      const message = body?.error === "invalid_code"
        ? t("errors.invalid_code")
        : t("errors.verify");
      setErrorMessage(message);
      setStatus("error");
    } catch {
      setErrorMessage(t("errors.unexpected"));
      setStatus("error");
    }
  }

  return (
    <main className="loginPage">
      <div className="loginAccessShell">
        <header className="loginAccessHeader">
          <div className="loginBrandLockup">
            <div className="loginBrandMark">
              <BrandLogo size={24} />
            </div>
            <div>
              <h1 className="loginBrandTitle">Spctre</h1>
              <p className="metadata loginBrandMeta">{t("brand_meta")}</p>
            </div>
          </div>
          <p className="metadata loginAccessHeaderNote">
            {t("header_note")}
          </p>
        </header>

        <div className="loginAccessGrid">
          <section className="loginPanel loginPanelPrimary">
            <div className="loginPanelHeader">
              <div className="loginPanelTitle">
                <KeyRound size={16} color="var(--accent)" />
                <h2>{t("title")}</h2>
              </div>
              <p className="meta">
                {t("description")}
              </p>
            </div>

            <form className="loginForm" onSubmit={handleSubmit}>
              <div className="loginFieldGroup">
                <label className="metadata" htmlFor="recover-email">{t("email")}</label>
                <input
                  id="recover-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  placeholder={t("email_placeholder")}
                  autoComplete="email"
                  required
                  disabled={status === "busy"}
                />
              </div>
              <div className="loginFieldGroup">
                <label className="metadata" htmlFor="recover-code">{t("code")}</label>
                <input
                  id="recover-code"
                  className="input"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
                  placeholder="XXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  disabled={status === "busy"}
                />
              </div>
              <button className="button buttonPrimary" type="submit" disabled={status === "busy"}>
                {status === "busy" ? t("verifying") : t("submit")}
              </button>
              {errorMessage ? (
                <p className="loginMessage loginMessageError">{errorMessage}</p>
              ) : null}
            </form>

            <Link className="loginSecondaryAction" href="/login">
              {t("back")}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
