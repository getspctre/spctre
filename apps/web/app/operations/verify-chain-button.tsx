"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

type VerifyState =
  | { status: "idle" }
  | { status: "pending" }
  | {
      status: "success";
      verified: boolean;
      totalEntries?: number;
      brokenEntryId?: string;
      brokenAt?: string;
    }
  | { status: "error"; error: string };

export function VerifyChainButton() {
  const t = useTranslations("operations.verify_chain");
  const [state, setState] = useState<VerifyState>({ status: "idle" });

  async function verifyChain() {
    setState({ status: "pending" });
    try {
      const response = await fetch("/api/operations/verify", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => null)) as {
        verified?: boolean;
        totalEntries?: number;
        brokenEntryId?: string;
        brokenAt?: string;
        error?: string;
      } | null;

      if (!response.ok && data?.verified !== false) {
        setState({ status: "error", error: data?.error ?? t("errors.verify") });
        return;
      }

      setState({
        status: "success",
        verified: Boolean(data?.verified),
        totalEntries: data?.totalEntries,
        brokenEntryId: data?.brokenEntryId,
        brokenAt: data?.brokenAt,
      });
    } catch {
      setState({ status: "error", error: t("errors.unreachable") });
    }
  }

  return (
    <span className="inlineResultAction">
      <button
        className="button"
        disabled={state.status === "pending"}
        onClick={verifyChain}
        title={t("title")}
        type="button"
      >
        <ShieldCheck size={16} />
        {state.status === "pending" ? t("verifying") : t("verify")}
      </button>
      {state.status === "success" ? (
        <span className={state.verified ? "pill pillAllow" : "pill pillBlock"} role="status">
          {state.verified
            ? state.totalEntries != null
              ? t("verified_count", { count: state.totalEntries })
              : t("verified")
            : (() => {
                const location = state.brokenEntryId ?? state.brokenAt;
                return location ? t("broken_at", { location }) : t("broken");
              })()}
        </span>
      ) : null}
      {state.status === "error" ? (
        <span className="meta publishError" role="alert">
          {state.error}
        </span>
      ) : null}
      <a className="button buttonSmall" href="/api/operations/verify" title={t("api_title")}>
        {t("api_json")}
      </a>
    </span>
  );
}
