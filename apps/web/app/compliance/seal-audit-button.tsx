"use client";

import { useState } from "react";
import { Stamp } from "lucide-react";
import { formatArtifactHash, formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";

type SealState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; sealToken: string; packetDigest: string; sealedAt: string }
  | { status: "error"; error: string };

export function SealAuditButton({
  packetId,
  branchId,
  revisionId,
  artifactHash,
  evidenceCount,
  appViewMode,
  auditLedgerHref,
}: {
  packetId: string;
  branchId: string;
  revisionId: string;
  artifactHash: string;
  evidenceCount: number;
  appViewMode: AppViewMode;
  auditLedgerHref: string;
}) {
  const [state, setState] = useState<SealState>({ status: "idle" });
  const [confirming, setConfirming] = useState(false);

  async function sealAudit() {
    setConfirming(false);
    setState({ status: "pending" });
    try {
      const response = await fetch("/api/compliance/seal", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => null)) as {
        sealToken?: string;
        packetDigest?: string;
        sealedAt?: string;
        error?: string;
      } | null;

      if (!response.ok || !data?.sealToken || !data.packetDigest || !data.sealedAt) {
        setState({ status: "error", error: data?.error ?? "Unable to seal the audit packet." });
        return;
      }

      setState({
        status: "success",
        sealToken: data.sealToken,
        packetDigest: data.packetDigest,
        sealedAt: data.sealedAt,
      });
    } catch {
      setState({ status: "error", error: "Unable to reach the seal service." });
    }
  }

  return (
    <div className="inlineResultAction">
      <button
        className="button"
        disabled={state.status === "pending"}
        onClick={() => setConfirming(true)}
        title="Record this packet's digest in the audit ledger"
        type="button"
      >
        <Stamp size={16} />
        {state.status === "pending" ? "Sealing..." : "Seal audit"}
      </button>
      {state.status === "success" ? (
        <span className="sealSuccess" role="status">
          <span className="pill pillAllow">Sealed {state.sealedAt.slice(0, 10)}</span>
          <a href={auditLedgerHref}>View in Audit Ledger</a>
          <code title={state.packetDigest}>{state.packetDigest.slice(0, 24)}…</code>
        </span>
      ) : null}
      {state.status === "error" ? (
        <span className="meta publishError" role="alert">
          {state.error}
        </span>
      ) : null}
      {confirming ? (
        <div className="sealConfirmation" role="dialog" aria-labelledby="seal-confirmation-title">
          <div>
            <p className="eyebrow">Tamper-evident audit record</p>
            <h2 id="seal-confirmation-title">Seal this compliance packet?</h2>
            <p className="meta">
              This records a digest for packet <code>{packetId}</code>, revision{" "}
              <code>{formatProvenanceId(revisionId, appViewMode, 16, hashToFingerprint)}</code>, and
              artifact{" "}
              <code>{formatArtifactHash(artifactHash, appViewMode, hashToFingerprint)}</code> in the
              Audit Ledger.
            </p>
            <p className="meta">
              The sealed packet contains {evidenceCount} evidence records from branch{" "}
              <code>{formatProvenanceId(branchId, appViewMode, 16, hashToFingerprint)}</code>.
            </p>
          </div>
          <div className="sealConfirmationActions">
            <button className="button" type="button" onClick={() => setConfirming(false)}>
              Keep unsealed
            </button>
            <button className="button buttonPrimary" type="button" onClick={sealAudit}>
              Seal packet
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
