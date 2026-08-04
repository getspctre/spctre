"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, Download, Loader } from "lucide-react";
import { importPolicyPack } from "./actions";
import type { ImportState } from "./actions";
import { buildWorkspacePath } from "@/lib/workspace/path";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ImportPackButtonProps {
  packId: string;
  workspaceId: string;
  workspaceSlug: string;
  mode: "install" | "upgrade";
  hasCustomizations: boolean;
  rulesCount: number;
  onComplete?: (branchId: string) => void;
  immediatePublishAllowed: boolean;
}

export function ImportPackButton({
  packId,
  workspaceId,
  workspaceSlug,
  mode,
  hasCustomizations,
  rulesCount,
  onComplete,
  immediatePublishAllowed,
}: ImportPackButtonProps) {
  const router = useRouter();
  const [state, action, isPending] = useActionState<ImportState, FormData>(importPolicyPack, null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submittedPublish, setSubmittedPublish] = useState(false);
  const packStatusChanged =
    state?.error === "This connector pack is already installed. Use upgrade instead." ||
    state?.error === "This connector pack is not installed yet. Install it first.";

  useEffect(() => {
    if (state?.result?.branchId) {
      onComplete?.(state.result.branchId);
    }
  }, [state?.result?.branchId, onComplete]);

  useEffect(() => {
    if (packStatusChanged) {
      router.refresh();
    }
  }, [packStatusChanged, router]);

  if (packStatusChanged) {
    return (
      <p className="meta" role="status">
        Updating available pack actions…
      </p>
    );
  }

  if (state?.result) {
    return (
      <div className="importSuccess">
        <CheckCircle2 size={14} />
        <span>
          {mode === "upgrade" ? "Upgraded" : "Installed"}
          {submittedPublish ? " & Published" : ""}:{" "}
        </span>
        <Link href={buildWorkspacePath(workspaceSlug, `/review?branch=${state.result.branchId}`)}>
          {submittedPublish ? "View history" : "Review branch"}
        </Link>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="mode" value={mode} />
      {mode === "upgrade" ? (
        <label className="checkboxLabel packUpgradeOption">
          <input
            defaultChecked={hasCustomizations}
            name="preserveCustomizations"
            type="checkbox"
            value="true"
          />
          Preserve local customizations during upgrade
        </label>
      ) : null}
      {state?.error ? <p className="importError">{state.error}</p> : null}

      {!immediatePublishAllowed ? (
        <button
          className="button buttonPrimary"
          type="submit"
          name="publish"
          value="false"
          onClick={() => setSubmittedPublish(false)}
          disabled={isPending}
        >
          {isPending ? <Loader size={14} className="spin" /> : "Install with review"}
        </button>
      ) : !showConfirm ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <button
            className="button buttonPrimary"
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
          >
            <Download size={14} />
            {mode === "upgrade" ? "Upgrade pack" : "Install pack"}
          </button>
          <button
            className="button"
            type="submit"
            name="publish"
            value="false"
            onClick={() => setSubmittedPublish(false)}
            disabled={isPending}
          >
            {isPending ? <Loader size={14} className="spin" /> : "Install with review"}
          </button>
        </div>
      ) : (
        <div
          className="packConfirmationCard"
          style={{
            border: "1px solid var(--border)",
            padding: 16,
            borderRadius: 8,
            background: "var(--panel-soft)",
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>
            <strong>Confirm Immediate Activation:</strong> This will{" "}
            {mode === "upgrade" ? "upgrade" : "install"} and publish the pack,{" "}
            {mode === "upgrade" ? "updating" : "adding"} {rulesCount} rules to your active workspace
            policy immediately.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="button buttonPrimary"
              type="submit"
              name="publish"
              value="true"
              onClick={() => setSubmittedPublish(true)}
              disabled={isPending}
            >
              {isPending && submittedPublish ? (
                <Loader size={14} className="spin" />
              ) : (
                "Confirm & Publish"
              )}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setShowConfirm(false);
                setSubmittedPublish(false);
              }}
              disabled={isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
