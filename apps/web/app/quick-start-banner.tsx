"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clipboard, KeyRound, ShieldX, Terminal, Zap } from "lucide-react";
import type { WebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { buildWorkspacePath } from "@/lib/workspace/path";
import {
  generateOnboardingSetupToken,
  sendAllowedDecision,
  sendBlockedDecision,
  type QuickStartState,
  type SetupTokenState,
} from "./quick-start-actions";
import { swallow } from "@/lib/platform/swallow";

interface Props {
  status: WebOnboardingStatus;
  workspaceSlug: string;
  controlPlaneUrl: string;
  surface?: "policies" | "evidence" | "agents" | "compliance" | "escalations" | "operations";
}

interface PublishedBundleRefs {
  branchId: string;
  revisionId: string;
  artifactHash: string;
}

// Copy-paste setup snippets for the three integration paths.
function buildSetupSnippets(
  apiBase: string,
  workspaceSlug: string,
  token: string,
  publishedBundle: PublishedBundleRefs
) {
  const cliBlock = [
    "npm install -g @spctre/cli",
    "spctre init",
    `spctre sync --workspace ${workspaceSlug}`,
  ].join("\n");
  const fetchBlock = [
    `const response = await fetch("${apiBase}/api/v1/gateway/decide", {`,
    '  method: "POST",',
    "  headers: {",
    `    authorization: "Bearer ${token}",`,
    '    "content-type": "application/json"',
    "  },",
    "  body: JSON.stringify({",
    '    decisionId: `onboarding-${Date.now()}`,',
    `    artifactHash: "${publishedBundle.artifactHash}",`,
    "    policyContext: [{",
    '      scope: "WORKSPACE",',
    `      branchId: "${publishedBundle.branchId}",`,
    `      revisionId: "${publishedBundle.revisionId}",`,
    `      artifactHash: "${publishedBundle.artifactHash}"`,
    "    }],",
    '    connector: "stripe",',
    '    action: "refund.create",',
    '    agentId: process.env.AGENT_ID ?? "onboarding-agent",',
    '    environment: "production"',
    "  })",
    "})",
    "",
    "const result = await response.json()",
    'if (!response.ok) throw new Error(result.error ?? "Gateway decision failed")',
    'if (result.decision.outcome !== "PROCEED") throw new Error(result.decision.reason)',
  ].join("\n");
  const curlBlock = [
    `curl -X POST ${apiBase}/api/v1/gateway/decide \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"decisionId":"onboarding-'$(date +%s)'","artifactHash":"${publishedBundle.artifactHash}","policyContext":[{"scope":"WORKSPACE","branchId":"${publishedBundle.branchId}","revisionId":"${publishedBundle.revisionId}","artifactHash":"${publishedBundle.artifactHash}"}],"connector":"stripe","action":"refund.create","agentId":"test","environment":"production"}'`,
  ].join("\n");

  return { cliBlock, fetchBlock, curlBlock };
}

function starterStateLabel(starterState: "idle" | "pending" | "ready" | "blocked"): string {
  if (starterState === "ready") return "Starter policy is published for this workspace.";
  if (starterState === "pending") return "Publishing the starter policy...";
  if (starterState === "blocked") return "Starter policy will be published when an admin sends the sample decision.";
  return "Preparing starter policy...";
}

function RealEvidenceBanner({ evidenceHref }: { evidenceHref: string }) {
  return (
    <section className="panel quickStartBanner" aria-label="Onboarding complete">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Onboarding · Real evidence</p>
          <h2>Real agent evidence is flowing</h2>
          <p className="meta">
            Your sample decision has been replaced by live runtime evidence from an agent.
          </p>
        </div>
        <CheckCircle2 size={20} className="sectionIcon" style={{ color: "var(--allow)" }} />
      </div>
      <a className="button buttonAllow" href={evidenceHref}>
        Inspect latest decision
        <ArrowRight size={14} />
      </a>
    </section>
  );
}

function SetupTokenRow({
  tokenAction,
  tokenPending,
  tokenState,
  liveStatus,
  copied,
  copyBlock,
}: {
  tokenAction: (formData: FormData) => void;
  tokenPending: boolean;
  tokenState: SetupTokenState;
  liveStatus: WebOnboardingStatus;
  copied: string | null;
  copyBlock: (id: string, value: string) => void;
}) {
  return (
    <>
      <div className="quickStartTokenRow">
        <form action={tokenAction}>
          <button className="button buttonAllow" type="submit" disabled={tokenPending}>
            <KeyRound size={15} />
            {tokenPending
              ? "Generating..."
              : liveStatus.setupTokenExists
                ? "Generate fresh setup token"
                : "Generate setup token"}
          </button>
        </form>
        {liveStatus.setupTokenExists && !tokenState?.ok ? (
          <p className="meta">
            Existing setup token: <code>{liveStatus.setupTokenPrefix}...</code>. Generate a fresh active token to reveal a new secret.
          </p>
        ) : null}
        {tokenState?.error ? (
          <p className="meta" style={{ color: "var(--block)" }}>{tokenState.error}</p>
        ) : null}
        {tokenState?.ok ? (
          <p className="meta" style={{ color: "var(--warn)" }}>
            This token is shown once and expires in 30 days. Copy it before leaving this page.
          </p>
        ) : null}
      </div>

      {tokenState?.ok ? (
        <div className="quickStartSecret">
          <code>{tokenState.rawToken}</code>
          <button className="button" type="button" onClick={() => copyBlock("token", tokenState.rawToken)}>
            <Clipboard size={14} />
            {copied === "token" ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </>
  );
}

// Track the live onboarding status: auto-publish the starter policy for fresh
// workspaces and poll for the first real evidence after a sample decision.
function useLiveOnboardingStatus(status: WebOnboardingStatus) {
  const [liveStatus, setLiveStatus] = useState(status);
  const [starterState, setStarterState] = useState<"idle" | "pending" | "ready" | "blocked">(
    status.publishedBundle ? "ready" : "idle"
  );

  const hasSampleDecision = liveStatus.quickStartEvidenceCount > 0;
  const hasRealEvidence = liveStatus.realEvidenceCount > 0;

  useEffect(() => {
    setLiveStatus(status);
    setStarterState(status.publishedBundle ? "ready" : "idle");
  }, [status]);

  useEffect(() => {
    if (liveStatus.publishedBundle || starterState !== "idle") return;
    let cancelled = false;
    setStarterState("pending");
    fetch("/api/onboarding/starter", { method: "POST", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { status?: WebOnboardingStatus } | null) => {
        if (cancelled) return;
        if (payload?.status) {
          setLiveStatus(payload.status);
          setStarterState("ready");
        } else {
          setStarterState("blocked");
        }
      })
      .catch(() => {
        if (!cancelled) setStarterState("blocked");
      });
    return () => {
      cancelled = true;
    };
  }, [liveStatus.publishedBundle, starterState]);

  useEffect(() => {
    if (!hasSampleDecision || hasRealEvidence) return;

    let cancelled = false;
    const loadStatus = () => {
      fetch("/api/onboarding/status", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload: { status?: WebOnboardingStatus } | null) => {
          if (!cancelled && payload?.status) setLiveStatus(payload.status);
        })
        .catch(swallow("fetch", undefined));
    };

    loadStatus();
    const interval = window.setInterval(loadStatus, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasSampleDecision, hasRealEvidence]);

  return { liveStatus, starterState, hasSampleDecision, hasRealEvidence };
}

export function QuickStartBanner({
  status,
  workspaceSlug,
  controlPlaneUrl,
  surface = "policies",
}: Props) {
  const [allowState, allowAction, allowPending] = useActionState<QuickStartState, FormData>(
    sendAllowedDecision,
    null
  );
  const [blockState, blockAction, blockPending] = useActionState<QuickStartState, FormData>(
    sendBlockedDecision,
    null
  );
  const [tokenState, tokenAction, tokenPending] = useActionState<SetupTokenState, FormData>(
    generateOnboardingSetupToken,
    null
  );
  const [copied, setCopied] = useState<string | null>(null);
  const { liveStatus, starterState, hasSampleDecision, hasRealEvidence } = useLiveOnboardingStatus(status);

  const pending = allowPending || blockPending;
  const error = allowState?.error ?? blockState?.error;
  const token = tokenState?.ok ? tokenState.rawToken : "<generate setup token first>";
  const hasToken = Boolean(tokenState?.ok);
  const evidenceHref = buildWorkspacePath(
    workspaceSlug,
    liveStatus.latestRealEvidenceId
      ? `/evidence?highlight=${encodeURIComponent(liveStatus.latestRealEvidenceId)}`
      : "/evidence"
  );
  const publishedBundle = liveStatus.publishedBundle ?? {
    branchId: "<branch-id>",
    revisionId: "<revision-id>",
    artifactHash: "<artifact-hash>",
  };
  const starterPolicyHref = surface === "policies" ? "#branches" : buildWorkspacePath(workspaceSlug, "/#branches");
  const apiBase = controlPlaneUrl.replace(/\/$/, "");
  const { cliBlock, fetchBlock, curlBlock } = buildSetupSnippets(apiBase, workspaceSlug, token, publishedBundle);

  function copyBlock(id: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    }).catch(swallow("writeText", undefined));
  }

  if (hasRealEvidence) {
    return <RealEvidenceBanner evidenceHref={evidenceHref} />;
  }

  if (hasSampleDecision) {
    return (
      <section className="panel quickStartBanner" aria-label="Connect a real agent">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Onboarding · Connect an agent</p>
            <h2>Your first sample decision appeared</h2>
            <p className="meta">
              Connect one real agent next. The first non-sample decision will show in the same Evidence stream.
            </p>
          </div>
          <Terminal size={20} className="sectionIcon" />
        </div>

        <SetupTokenRow
          tokenAction={tokenAction}
          tokenPending={tokenPending}
          tokenState={tokenState}
          liveStatus={liveStatus}
          copied={copied}
          copyBlock={copyBlock}
        />

        <div className="quickStartCodeGrid">
          <SetupCodeBlock
            id="cli"
            title="CLI"
            code={cliBlock}
            copied={copied}
            onCopy={copyBlock}
          />
          <SetupCodeBlock
            id="fetch"
            title="JavaScript"
            code={fetchBlock}
            copied={copied}
            onCopy={copyBlock}
            disabled={!hasToken}
            disabledMessage="Generate a setup token before copying this gateway request."
          />
          <SetupCodeBlock
            id="curl"
            title="curl"
            code={curlBlock}
            copied={copied}
            onCopy={copyBlock}
            disabled={!hasToken}
            disabledMessage="Generate a setup token before copying this gateway request."
          />
        </div>
      </section>
    );
  }

  return (
    <section className="panel quickStartBanner" aria-label="Quick start">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Quick start · Try governance now</p>
          <h2>{surface === "policies" ? "Publish a starter policy" : "Send your first governed decision"}</h2>
          <p className="meta">
            Send a sample decision to see governance in action, no CLI or agent setup needed.
            The evidence row will include the rule, branch, revision, and artifact hash that governed it.
          </p>
          <p className="meta">{starterStateLabel(starterState)}</p>
        </div>
        <CheckCircle2 size={20} className="sectionIcon" style={{ color: "var(--allow)" }} />
      </div>

      <div className="quickStartActions">
        <form action={allowAction}>
          <button className="button buttonAllow" type="submit" disabled={pending}>
            <Zap size={15} />
            {allowPending ? "Sending…" : "Send an allowed action"}
          </button>
          <p className="meta quickStartHint">
            <code>sample.event.register</code> — matches the ALLOW rule
          </p>
        </form>

        <form action={blockAction}>
          <button className="button" type="submit" disabled={pending}
            style={{ borderColor: "var(--block)", color: "var(--block)" }}>
            <ShieldX size={15} />
            {blockPending ? "Sending…" : "Send a blocked action"}
          </button>
          <p className="meta quickStartHint">
            <code>sample.payment.create</code> — matches the DENY rule
          </p>
        </form>

        <a className="button" href={starterPolicyHref} style={{ alignSelf: "flex-start" }}>
          View starter policy
          <ArrowRight size={14} />
        </a>
      </div>

      {error ? (
        <p className="meta" style={{ color: "var(--block)", marginTop: 8 }}>{error}</p>
      ) : null}
    </section>
  );
}

function SetupCodeBlock({
  id,
  title,
  code,
  copied,
  onCopy,
  disabled = false,
  disabledMessage,
}: {
  id: string;
  title: string;
  code: string;
  copied: string | null;
  onCopy: (id: string, value: string) => void;
  disabled?: boolean;
  disabledMessage?: string;
}) {
  return (
    <div className={disabled ? "quickStartCodeBlock quickStartCodeBlockDisabled" : "quickStartCodeBlock"}>
      <div className="rowHeader">
        <p className="eyebrow">{title}</p>
        <button
          className="iconButton"
          type="button"
          aria-label={`Copy ${title}`}
          disabled={disabled}
          onClick={() => onCopy(id, code)}
        >
          <Clipboard size={15} />
        </button>
      </div>
      <pre><code>{code}</code></pre>
      {disabled && disabledMessage ? <p className="meta">{disabledMessage}</p> : null}
      {copied === id ? <p className="meta">Copied</p> : null}
    </div>
  );
}
