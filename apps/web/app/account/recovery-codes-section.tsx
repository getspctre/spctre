"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { swallow } from "@/lib/platform/swallow";

interface RecoveryCodesSectionProps {
  unusedCount: number;
}

export function RecoveryCodesSection({ unusedCount }: RecoveryCodesSectionProps) {
  const t = useTranslations("account.recovery");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function handleGenerate() {
    if (!confirmed && unusedCount > 0) {
      setConfirmed(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/recovery/generate", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { codes?: string[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || t("errors.generate"));
      if (!data?.codes?.length) throw new Error(t("errors.empty_response"));
      setCodes(data.codes!);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.unknown"));
    } finally {
      setBusy(false);
      setConfirmed(false);
    }
  }

  return (
    <section className="panel">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="meta">
          {t("description")}
        </p>
      </div>

      {codes ? (
        <div style={{ display: "grid", gap: "10px" }}>
          <p className="meta">
            {t("save_codes")}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px",
              padding: "12px",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              fontFamily: "monospace",
              fontSize: "13px",
            }}
          >
            {codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button
            className="button"
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(codes.join("\n")).catch(swallow("writeText", undefined));
            }}
          >
            {t("copy_all")}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {unusedCount > 0 ? (
            <p className="meta">{t("unused_remaining", { count: unusedCount })}</p>
          ) : (
            <p className="meta">{t("empty")}</p>
          )}

          {confirmed ? (
            <p className="meta workspaceError">
              {t("replace_warning")}
            </p>
          ) : null}

          <button
            className="button buttonPrimary accountAction"
            type="button"
            onClick={handleGenerate}
            disabled={busy}
          >
            {busy
              ? t("generating")
              : unusedCount > 0
              ? confirmed
                ? t("confirm_replace")
                : t("generate_new")
              : t("generate")}
          </button>
        </div>
      )}

      {error ? <p className="meta workspaceError">{error}</p> : null}
    </section>
  );
}
