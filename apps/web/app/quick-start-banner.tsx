"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clipboard,
  KeyRound,
  ShieldX,
  Terminal,
  Zap,
} from "lucide-react";
import type { WebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { buildWorkspacePath } from "@/lib/workspace/path";
import {
  generateOnboardingSetupToken,
  sendAllowedDecision,
  sendBlockedDecision,
  type QuickStartState,
  type SetupTokenState,
} from "./quick-start-actions";

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
  publishedBundle: PublishedBundleRefs,
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
    "    decisionId: `onboarding-${Date.now()}`,",
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

type StarterState = "idle" | "pending" | "ready" | "forbidden" | "signed-out" | "error";

function starterStateLabel(starterState: StarterState): string {
  if (starterState === "ready") return "Starter policy is published for this workspace.";
  if (starterState === "pending") return "Publishing the starter policy...";
  if (starterState === "forbidden")
    return "An administrator must publish the starter policy for this workspace. Ask your workspace administrator to complete this step.";
  if (starterState === "signed-out")
    return "Your session has expired. Sign in again to prepare the starter policy.";
  if (starterState === "error")
    return "Could not prepare the starter policy. Check your connection and try again.";
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
            Your agent has sent real runtime evidence. Sample decisions remain available separately.
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
            Existing setup token: <code>{liveStatus.setupTokenPrefix}...</code>. Generate a fresh
            active token to reveal a new secret.
          </p>
        ) : null}
        {tokenState?.error ? (
          <p className="meta" style={{ color: "var(--block)" }}>
            {tokenState.error}
          </p>
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
          <button
            className="button"
            type="button"
            onClick={() => copyBlock("token", tokenState.rawToken)}
          >
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
  const [attempt, setAttempt] = useState(0);
  const [statusError, setStatusError] = useState(false);
  const [starterState, setStarterState] = useState<StarterState>(
    status.publishedBundle ? "ready" : "idle",
  );

  const hasSampleDecision = liveStatus.quickStartEvidenceCount > 0;
  const hasRealEvidence = liveStatus.realEvidenceCount > 0;

  useEffect(() => {
    setLiveStatus(status);
    setStarterState(status.publishedBundle ? "ready" : "idle");
  }, [status]);

  useEffect(() => {
    if (liveStatus.publishedBundle) return;
    const controller = new AbortController();
    setStarterState("pending");
    fetch("/api/onboarding/starter", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setStarterState(
            response.status === 403
              ? "forbidden"
              : response.status === 401
                ? "signed-out"
                : "error",
          );
          return;
        }
        const payload = (await response.json()) as { status?: WebOnboardingStatus };
        if (controller.signal.aborted) return;
        if (payload.status?.publishedBundle) {
          setLiveStatus(payload.status);
          setStarterState("ready");
        } else setStarterState("error");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStarterState("error");
      });
    return () => controller.abort();
  }, [liveStatus.publishedBundle, attempt]);

  useEffect(() => {
    if (!hasSampleDecision || hasRealEvidence) return;

    let cancelled = false;
    const loadStatus = () => {
      fetch("/api/onboarding/status", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { status?: WebOnboardingStatus } | null) => {
          if (cancelled) return;
          setStatusError(!payload?.status);
          if (payload?.status) setLiveStatus(payload.status);
        })
        .catch(() => {
          if (!cancelled) setStatusError(true);
        });
    };

    loadStatus();
    const interval = window.setInterval(loadStatus, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasSampleDecision, hasRealEvidence]);

  return {
    liveStatus,
    starterState,
    hasSampleDecision,
    hasRealEvidence,
    statusError,
    retryStarter: () => setAttempt((value) => value + 1),
  };
}

export function QuickStartBanner({
  status,
  workspaceSlug,
  controlPlaneUrl,
  surface = "policies",
}: Props) {
  const [allowState, allowAction, allowPending] = useActionState<QuickStartState, FormData>(
    sendAllowedDecision,
    null,
  );
  const [blockState, blockAction, blockPending] = useActionState<QuickStartState, FormData>(
    sendBlockedDecision,
    null,
  );
  const [tokenState, tokenAction, tokenPending] = useActionState<SetupTokenState, FormData>(
    generateOnboardingSetupToken,
    null,
  );
  const methodId = useId();
  const [method, setMethod] = useState<"cli" | "fetch" | "curl">("cli");
  const [copyError, setCopyError] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const {
    liveStatus,
    starterState,
    hasSampleDecision,
    hasRealEvidence,
    statusError,
    retryStarter,
  } = useLiveOnboardingStatus(status);

  const pending = allowPending || blockPending;
  const error = allowState?.error ?? blockState?.error;
  const token = tokenState?.ok ? tokenState.rawToken : "<generate setup token first>";
  const hasToken = Boolean(tokenState?.ok);
  const evidenceHref = buildWorkspacePath(
    workspaceSlug,
    liveStatus.latestRealEvidenceId
      ? `/evidence?highlight=${encodeURIComponent(liveStatus.latestRealEvidenceId)}`
      : "/evidence",
  );
  const publishedBundle = liveStatus.publishedBundle ?? {
    branchId: "<branch-id>",
    revisionId: "<revision-id>",
    artifactHash: "<artifact-hash>",
  };
  const starterPolicyHref = buildWorkspacePath(workspaceSlug, "/#branches");
  const apiBase = controlPlaneUrl.replace(/\/$/, "");
  const { cliBlock, fetchBlock, curlBlock } = buildSetupSnippets(
    apiBase,
    workspaceSlug,
    token,
    publishedBundle,
  );

  function copyBlock(id: string, value: string) {
    setCopyError(false);
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => {
        setCopyError(true);
      });
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
              Connect one real agent next. The first non-sample decision will show in the same
              Evidence stream.
            </p>
          </div>
          <Terminal size={20} className="sectionIcon" />
        </div>

        <label className="meta" htmlFor={methodId}>
          How will you connect your agent?
        </label>
        <select
          className="input"
          id={methodId}
          value={method}
          onChange={(event) => setMethod(event.target.value as typeof method)}
        >
          <option value="cli">CLI (recommended for local setup)</option>
          <option value="fetch">JavaScript</option>
          <option value="curl">HTTP with curl</option>
        </select>
        <p className="meta">
          {method === "cli"
            ? "Install the CLI, sign in during init, then sync this workspace. No setup token is needed for this path."
            : "Generate a setup token, then run this request from your agent environment to test the decision gateway."}
        </p>
        {method !== "cli" ? (
          <SetupTokenRow
            tokenAction={tokenAction}
            tokenPending={tokenPending}
            tokenState={tokenState}
            liveStatus={liveStatus}
            copied={copied}
            copyBlock={copyBlock}
          />
        ) : null}
        <div className="quickStartCodeGrid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <SetupCodeBlock
            id={method}
            title={method === "cli" ? "CLI" : method === "fetch" ? "JavaScript" : "curl"}
            code={method === "cli" ? cliBlock : method === "fetch" ? fetchBlock : curlBlock}
            copied={copied}
            onCopy={copyBlock}
            disabled={method !== "cli" && !hasToken}
            disabledMessage="Generate a setup token before copying this gateway request."
          />
        </div>
        <p className="meta" role="status" aria-live="polite">
          {copyError
            ? "Copy failed. Select the visible code and copy it manually."
            : statusError
              ? "Could not check for agent evidence. We will retry automatically; you can also open Decision evidence."
              : "Waiting for your first non-sample decision. This page checks automatically."}
        </p>
        <a className="button" href={evidenceHref}>
          Open decision evidence
        </a>
      </section>
    );
  }

  return (
    <section className="panel quickStartBanner" aria-label="Quick start">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Quick start · Try governance now</p>
          <h2>
            {surface === "policies"
              ? "Publish a starter policy"
              : "Send your first governed decision"}
          </h2>
          <p className="meta">
            Send a sample decision to see governance in action, no CLI or agent setup needed. The
            evidence row will include the rule, branch, revision, and artifact hash that governed
            it.
          </p>
          <p className="meta" role="status" aria-live="polite">
            {starterStateLabel(starterState)}
          </p>
          {starterState === "error" ? (
            <button className="button" type="button" onClick={retryStarter}>
              Retry starter setup
            </button>
          ) : null}
          {starterState === "signed-out" ? (
            <a className="button" href="/login">
              Sign in again
            </a>
          ) : null}
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
          <button
            className="button"
            type="submit"
            disabled={pending}
            style={{ borderColor: "var(--block)", color: "var(--block)" }}
          >
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
        <p className="meta" role="alert" style={{ color: "var(--block)", marginTop: 8 }}>
          {error}
        </p>
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
    <div
      className={
        disabled ? "quickStartCodeBlock quickStartCodeBlockDisabled" : "quickStartCodeBlock"
      }
    >
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
      <pre>
        <code>{code}</code>
      </pre>
      {disabled && disabledMessage ? <p className="meta">{disabledMessage}</p> : null}
      <p className="meta" role="status" aria-live="polite">
        {copied === id ? "Copied" : ""}
      </p>
    </div>
  );
}
