import * as fs from "node:fs";
import * as path from "node:path";
import { loadPortablePolicyKernel } from "@spctre/policy-schema/wasm-node";
import type {
  AgtCompatiblePolicyBundle,
  AgtRuntimeDecisionInput,
  EvaluationResult,
} from "@spctre/policy-schema";
import { readConfig } from "./config";
import type { SpctreCliConfig } from "./config";
import { refreshIfNeeded } from "./refresh";
import { isShadowModeActive, appendShadowLog } from "./shadow";
import { resolveGatewayConfig, requestGatewayDecision, pollEscalationResolution } from "./gateway";
import type { CredentialGrant, GatewayConfig, GatewayDecisionResponse } from "./gateway";
import { pushToBuffer, flushBuffer } from "./buffer.js";

type HookHarness = "claude" | "codex" | "gemini" | "antigravity" | "kimi";
type HookMode = "observe" | "enforce";

interface PreToolUseHookPayload {
  // Claude Code / Codex / Gemini CLI / Kimi Code hook payload shape. Kimi emits
  // the same snake_case `tool_name` / `tool_input` pair (its runner snake-cases
  // the top-level keys of every hook payload).
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  // Antigravity (IDE + agy CLI) hook payload shape — camelCase per
  // https://antigravity.google/docs/hooks
  toolCall?: { name?: string; args?: Record<string, unknown> };
}

interface PreToolUseOptions {
  harness?: HookHarness | "agy";
  mode?: HookMode;
  enforce?: boolean;
}

interface GovernedAction {
  connector: string;
  action: string;
  domains: string[];
}

const TRANSCRIPT_PARAMETER_KEYS = new Set([
  "assistant_messages",
  "assistant_response",
  "chain_of_thought",
  "chat_history",
  "conversation",
  "conversations",
  "cot",
  "history",
  "messages",
  "model_response",
  "prompt",
  "prompts",
  "reasoning",
  "session",
  "session_history",
  "system_prompt",
  "transcript",
  "transcripts",
  "user_prompt",
]);

// Ordered most-to-least specific. Each entry: [pattern, connector, domains]
const BASH_CONNECTOR_PATTERNS: Array<[RegExp, string, string[]]> = [
  [/\bstripe\b/i, "stripe", ["billing"]],
  [/github\.com\b|(?:^|\s|\/)gh\s/, "github", ["vcs"]],
  [/gitlab\.com\b/i, "gitlab", ["vcs"]],
  [/\bslack\.com\b|\bslack\s/i, "slack", ["messaging"]],
  [/\btwilio\b/i, "twilio", ["messaging"]],
  [/\bsendgrid\b/i, "sendgrid", ["email"]],
  [/\bsalesforce\b/i, "salesforce", ["crm"]],
  [/\bzendesk\b/i, "zendesk", ["support"]],
  [/\bpsql\b|\bpg_dump\b|\bpg_restore\b/i, "postgres", ["database"]],
  [/\bmysql\b|\bmysqldump\b/i, "mysql", ["database"]],
  [/\bmongo\b/i, "mongodb", ["database"]],
  [/(?:^|\s)aws\s|awscli\b|s3:\/\//i, "aws", ["infrastructure"]],
  [/(?:^|\s)gcloud\s/i, "gcp", ["infrastructure"]],
  [/(?:^|\s)kubectl\s/i, "kubernetes", ["infrastructure"]],
  [/\bterraform\b/i, "terraform", ["infrastructure"]],
  [/\bpulumi\b/i, "pulumi", ["infrastructure"]],
  [/(?:^|\s)az\s+[a-z]/i, "azure", ["infrastructure"]],
];

function resolveGovernedAction(
  toolName: string,
  input: Record<string, unknown>,
): GovernedAction | null {
  // MCP tools: mcp__<server>__<tool> — always governed
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3) {
      return { connector: parts[1], action: parts.slice(2).join("."), domains: ["external"] };
    }
  }

  switch (toolName) {
    case "WebFetch":
    case "WebSearch":
    case "FetchURL":
    case "search_web":
    case "read_url_content":
    case "web_fetch":
    case "google_web_search": {
      const isSearch =
        toolName === "WebSearch" || toolName === "search_web" || toolName === "google_web_search";
      let raw = (isSearch ? input.query : (input.url ?? input.Url)) as string | undefined;
      if (!raw && toolName === "web_fetch") {
        // Gemini CLI's web_fetch embeds the target URL(s) inside a prompt string.
        raw = (((input.prompt as string | undefined) ?? "").match(/https?:\/\/[^\s"']+/) ?? [])[0];
      }
      if (!raw)
        return { connector: "web", action: isSearch ? "search" : "fetch", domains: ["external"] };
      try {
        const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        return {
          connector: u.hostname.replace(/^www\./, ""),
          action: "fetch",
          domains: ["external"],
        };
      } catch {
        return { connector: "web", action: "fetch", domains: ["external"] };
      }
    }

    case "Bash":
    case "shell":
    case "shell_command":
    case "exec_command":
    case "run_command":
    case "run_shell_command": {
      const cmd =
        (input.command as string | undefined) ??
        (input.cmd as string | undefined) ??
        (input.CommandLine as string | undefined) ??
        "";
      // Known connector CLI/SDK patterns
      for (const [pattern, connector, domains] of BASH_CONNECTOR_PATTERNS) {
        if (pattern.test(cmd)) return { connector, action: "execute", domains };
      }
      // Generic HTTP via curl/wget/http/fetch CLI
      if (/\bcurl\b|\bwget\b|\bhttpie\b|\bhttp\s/i.test(cmd)) {
        const urlMatch = cmd.match(/https?:\/\/([^/\s"']+)/);
        if (urlMatch) {
          return {
            connector: urlMatch[1].replace(/^www\./, ""),
            action: "http",
            domains: ["external"],
          };
        }
      }
      return null;
    }

    default:
      return null; // Read, Edit, Write, TodoWrite, Agent, etc. — not governed
  }
}

function adapterForHarness(harness: HookHarness): string {
  return `spctre-dev-hook:${harness}`;
}

// Antigravity (IDE + agy CLI) gates PreToolUse hooks on a stdout JSON decision
// ({"decision":"allow"|"deny",...}) instead of the exit-code contract used by
// Claude Code, Codex, and Gemini CLI. Set once per invocation in pretooluse().
let activeHarness: HookHarness = "claude";

// Kimi Code and Antigravity both ignore hook stdout as a source of rewritten
// tool input, so a JIT credential grant cannot be delivered through them.
const HARNESS_SUPPORTS_INPUT_REWRITE: Record<HookHarness, boolean> = {
  claude: true,
  codex: true,
  gemini: true,
  antigravity: false,
  kimi: false,
};

const HARNESS_DISPLAY_NAME: Record<HookHarness, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  antigravity: "Antigravity",
  kimi: "Kimi Code",
};

// Kimi Code kills a PreToolUse hook at its declared timeout (600s ceiling, the
// value `install-hook --kimi` writes) and treats the kill as ALLOW. A gateway
// wait that outlives the hook would therefore fail open silently, so cap the
// wait short of the kill and let the normal outage path decide instead.
const KIMI_MAX_GATEWAY_WAIT_MS = 540_000;

function clampGatewayConfigForHarness(
  config: GatewayConfig | null,
  harness: HookHarness,
): GatewayConfig | null {
  if (!config || harness !== "kimi" || config.timeoutMs <= KIMI_MAX_GATEWAY_WAIT_MS) return config;
  return { ...config, timeoutMs: KIMI_MAX_GATEWAY_WAIT_MS };
}

function emitAllowDecision(): void {
  if (activeHarness !== "antigravity") return;
  process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
}

function blockAndExit(stderrMessage: string, denyReason: string): never {
  console.error(stderrMessage);
  if (activeHarness === "antigravity") {
    process.stdout.write(`${JSON.stringify({ decision: "deny", reason: denyReason })}\n`);
    process.exit(0);
  }
  process.exit(2);
}

function currentHarness(options: PreToolUseOptions): HookHarness {
  if (options.harness === "codex") return "codex";
  if (options.harness === "gemini") return "gemini";
  if (options.harness === "claude") return "claude";
  if (options.harness === "antigravity" || options.harness === "agy") return "antigravity";
  if (options.harness === "kimi") return "kimi";
  if (process.env.SPCTRE_HARNESS === "codex") return "codex";
  if (process.env.SPCTRE_HARNESS === "gemini") return "gemini";
  if (process.env.SPCTRE_HARNESS === "antigravity" || process.env.SPCTRE_HARNESS === "agy")
    return "antigravity";
  if (process.env.SPCTRE_HARNESS === "kimi") return "kimi";
  return "claude";
}

export function parseHookMode(options: PreToolUseOptions): HookMode {
  if (options.enforce) return "enforce";
  if (options.mode === "enforce" || options.mode === "observe") return options.mode;
  if (options.mode) {
    console.error(
      `Error: unsupported hook mode "${options.mode}". Expected "observe" or "enforce".`,
    );
    process.exit(1);
  }
  if (process.env.SPCTRE_HOOK_MODE === "enforce") return "enforce";
  if (process.env.SPCTRE_HOOK_MODE && process.env.SPCTRE_HOOK_MODE !== "observe") {
    console.error(
      `Error: unsupported SPCTRE_HOOK_MODE "${process.env.SPCTRE_HOOK_MODE}". Expected "observe" or "enforce".`,
    );
    process.exit(1);
  }
  return "observe";
}

function buildHeartbeatPayload(
  config: SpctreCliConfig,
  toolName: string,
  harness: HookHarness,
  mode: HookMode,
): AgtRuntimeDecisionInput {
  return {
    decisionId: `hb-${Date.now()}`,
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    environment: config.environment,
    runtimeTarget: { stack: "LOCAL", adapter: adapterForHarness(harness) },
    agentId: config.agentId,
    connector: "system",
    action: "heartbeat",
    status: "ALLOW",
    reason: "PreToolUse heartbeat",
    policyRefs: ["system.heartbeat"],
    artifactHash: config.artifactHash,
    policyContext: config.policyContext,
    latencyMs: 0,
    createdAt: new Date().toISOString(),
    rawEvidence: { source: "pretooluse-hook", harness, tool: toolName, enforcementMode: mode },
  };
}

async function postEvidence(
  config: SpctreCliConfig,
  payload: AgtRuntimeDecisionInput,
): Promise<void> {
  const url = `${config.controlPlaneUrl.replace(/\/+$/, "")}/api/evidence`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        "x-spctre-source": "hook",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    pushToBuffer("evidence", payload);
  }
}

export function shouldBlockDecision(mode: HookMode, status: string): boolean {
  return mode === "enforce" && status === "DENY";
}

function normalizeParameterKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function filterGatewayToolParameters(
  input: Record<string, unknown>,
): Record<string, unknown> | undefined {
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (TRANSCRIPT_PARAMETER_KEYS.has(normalizeParameterKey(key))) {
        continue;
      }
      result[key] = walk(child);
    }
    return result;
  }

  const filtered = walk(input);
  if (!filtered || typeof filtered !== "object" || Array.isArray(filtered)) return undefined;
  return Object.keys(filtered).length > 0 ? (filtered as Record<string, unknown>) : undefined;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      buf += c;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve("{}"));
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);
}

const ALLOWED_CONNECTOR_PARAMETERS: Record<string, string[]> = {
  stripe: [
    "apiKey",
    "token",
    "auth.token",
    "stripeKey",
    "stripe_key",
    "key",
    "auth.apiKey",
    "auth.api_key",
  ],
  mock: ["token", "apiKey", "key", "stripeKey", "auth.token"],
};

export function injectParameter(
  obj: unknown,
  path: string,
  value: unknown,
  connector?: string,
): boolean {
  if (!obj || typeof obj !== "object" || !path) return false;

  const parts = path.split(".");
  const blockedKeys = ["__proto__", "prototype", "constructor"];
  if (parts.some((part) => blockedKeys.includes(part))) {
    console.error(`Blocked attempt to inject parameter via unsafe path: ${path}`);
    return false;
  }

  if (connector) {
    const allowed = ALLOWED_CONNECTOR_PARAMETERS[connector.toLowerCase()];
    if (!allowed || !allowed.includes(path)) {
      console.error(`Blocked attempt to inject parameter "${path}" for connector "${connector}".`);
      return false;
    }
  }

  let current = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return true;
}

interface GatewayFlowContext {
  refreshed: SpctreCliConfig;
  governed: GovernedAction;
  toolInput: Record<string, unknown>;
  payload: PreToolUseHookPayload;
  evidencePayload: AgtRuntimeDecisionInput;
  heartbeat: Promise<void>;
  evidence: Promise<void>;
}

// Injects a JIT credential grant into the tool input and exits: 0 (allow with
// modified payload on stdout) or 2 (blocked). Never returns.
async function applyCredentialGrantAndExit(
  grant: CredentialGrant,
  ctx: GatewayFlowContext,
): Promise<never> {
  if (!HARNESS_SUPPORTS_INPUT_REWRITE[activeHarness]) {
    // Neither Antigravity nor Kimi Code lets a PreToolUse hook rewrite the tool
    // input — both ignore stdout for that purpose — so JIT-required actions fail
    // closed rather than executing without the ephemeral credential.
    const reason = `JIT credential injection is not supported by the ${HARNESS_DISPLAY_NAME[activeHarness]} hook contract — blocked (fail-closed).`;
    await withTimeout(Promise.all([ctx.heartbeat, ctx.evidence]), 2000);
    blockAndExit(`Spctre policy DENY: ${reason}`, reason);
  }
  const injected = injectParameter(
    ctx.toolInput,
    grant.injectedParameter,
    grant.credentialValue,
    ctx.governed.connector,
  );
  if (!injected) {
    const reason = `Failed to inject JIT credential into parameter "${grant.injectedParameter}" — blocked by security policy.`;
    blockAndExit(`Spctre policy DENY: ${reason}`, reason);
  }
  console.error(
    `Spctre JIT: Injected ephemeral ${grant.credentialType} credential into parameter "${grant.injectedParameter}".`,
  );
  process.stdout.write(JSON.stringify(ctx.payload) + "\n");
  await withTimeout(Promise.all([ctx.heartbeat, ctx.evidence]), 500);
  process.exit(0);
}

// Gateway unreachable: post degraded evidence, then block (fail-closed) or
// fall through to the local decision (fail-open).
async function handleGatewayOutage(
  gwConfig: GatewayConfig,
  ctx: GatewayFlowContext,
): Promise<"continue"> {
  const isJitRequired = ctx.governed.connector === "stripe" || ctx.governed.connector === "mock";
  const isFailClosed = gwConfig.outagePolicy === "fail-closed" || isJitRequired;
  const outageReason = isJitRequired
    ? "Gateway decision failed (outage) — JIT credentials are required for this action. Fail-closed enforced."
    : isFailClosed
      ? "Gateway decision failed (outage) — fail-closed policy enforced."
      : "Gateway decision failed (outage) — fail-open policy enforced.";

  const degradedEvidence: AgtRuntimeDecisionInput = {
    ...ctx.evidencePayload,
    status: isFailClosed ? "DENY" : ctx.evidencePayload.status,
    reason: `${ctx.evidencePayload.reason} (${outageReason})`,
    rawEvidence: {
      ...ctx.evidencePayload.rawEvidence,
      gatewayOutage: true,
      gatewayOutagePolicy: gwConfig.outagePolicy,
    },
  };

  // Post degraded evidence (best-effort, 1s timeout)
  await withTimeout(
    postEvidence(ctx.refreshed, degradedEvidence).catch(() => {}),
    1000,
  );

  if (isFailClosed) {
    blockAndExit(`Spctre policy DENY: ${outageReason}`, outageReason);
  }
  console.error(
    `Spctre gateway WARN: Gateway decision failed (outage) — fail-open policy allowed execution.`,
  );
  return "continue"; // fall through to normal local decision/shadow checks
}

// ESCALATE queued at the gateway: wait for the human reviewer and act on the
// resolution. Returns "allow" on PROCEED without a grant; otherwise exits.
async function handleGatewayEscalation(
  gwConfig: GatewayConfig,
  decision: GatewayDecisionResponse["decision"],
  ctx: GatewayFlowContext,
): Promise<"allow"> {
  const slaHours = decision.slaHours ?? 4;
  console.error(
    `Spctre ESCALATE: ${decision.reason} — waiting for human review (SLA: ${slaHours}h)…`,
  );

  // Post evidence immediately so audit trail is captured
  await withTimeout(Promise.all([ctx.heartbeat, ctx.evidence]), 2000);

  const resolution = await pollEscalationResolution(gwConfig, ctx.evidencePayload.decisionId);

  if (resolution.agentGuidance) {
    console.error(`Spctre reviewer guidance: ${resolution.agentGuidance}`);
  }

  if (resolution.resolutionOutcome === "PROCEED") {
    console.error("Spctre escalation RESOLVED: PROCEED — action allowed.");
    if (resolution.credentialGrant) {
      await applyCredentialGrantAndExit(resolution.credentialGrant, ctx);
    }
    return "allow";
  }

  if (
    resolution.resolutionOutcome === "ABORT" ||
    resolution.resolutionOutcome === "ESCALATE" ||
    resolution.status === "EXPIRED"
  ) {
    const reason =
      resolution.status === "EXPIRED"
        ? "Gateway escalation timed out — fail-closed."
        : resolution.resolutionOutcome === "ESCALATE"
          ? `Gateway escalation resolved: ESCALATE${resolution.resolutionNote ? ` — ${resolution.resolutionNote}` : " — Returned to queue for additional review. Please run the tool again to start a new decision cycle."}`
          : `Gateway escalation resolved: ABORT${resolution.resolutionNote ? ` — ${resolution.resolutionNote}` : ""}`;
    blockAndExit(`Spctre policy DENY: ${reason}`, reason);
  }

  // Fallback block on unknown resolution outcome
  blockAndExit(
    "Spctre policy DENY: Unknown gateway resolution outcome.",
    "Unknown gateway resolution outcome.",
  );
}

// Evaluate the governed action against the cloud gateway. Returns "continue"
// when the local decision path should still run, "allow" when the gateway
// resolved the action; exits the process on blocking outcomes.
async function runGatewayFlow(
  gwConfig: GatewayConfig,
  ctx: GatewayFlowContext,
): Promise<"continue" | "allow"> {
  const gwResponse = await requestGatewayDecision(gwConfig, ctx.refreshed, {
    decisionId: ctx.evidencePayload.decisionId,
    connector: ctx.governed.connector,
    action: ctx.governed.action,
    toolIntent: (ctx.toolInput.tool_intent ?? ctx.toolInput.toolIntent) as string | undefined,
    planSummary: (ctx.toolInput.plan_summary ?? ctx.toolInput.planSummary) as string | undefined,
    toolParameters: filterGatewayToolParameters(ctx.toolInput),
  });

  if (gwResponse === null) {
    return handleGatewayOutage(gwConfig, ctx);
  }

  if (gwResponse.decision.outcome === "ABORT") {
    // ABORT = immediate block regardless of local decision
    await withTimeout(Promise.all([ctx.heartbeat, ctx.evidence]), 2000);
    blockAndExit(`Spctre gateway ABORT: ${gwResponse.decision.reason}`, gwResponse.decision.reason);
  }

  if (gwResponse.decision.outcome === "ESCALATE" && gwResponse.queued) {
    return handleGatewayEscalation(gwConfig, gwResponse.decision, ctx);
  }

  // PROCEED from gateway — check if credential grant is present
  if (gwResponse.decision.outcome === "PROCEED" && gwResponse.decision.credentialGrant) {
    await applyCredentialGrantAndExit(gwResponse.decision.credentialGrant, ctx);
  }

  return "continue";
}

function loadPolicyBundle(refreshed: SpctreCliConfig): AgtCompatiblePolicyBundle | null {
  const bundlePath = path.resolve(process.cwd(), refreshed.bundlePath);
  if (!fs.existsSync(bundlePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(bundlePath, "utf8")) as AgtCompatiblePolicyBundle;
  } catch {
    return null; // unreadable — allow
  }
}

// Local enforcement runs the portable build of the same kernel the control plane
// and the worker use, rather than a TypeScript reimplementation of it. The hook
// used to answer policy questions with its own matcher, which meant a locally
// blocked action and a runtime-blocked action were two different judgements. The
// portable kernel also needs no per-platform binary, so the hook keeps working on
// hosts the native addon does not ship for.
async function evaluateLocalDecision(
  bundle: AgtCompatiblePolicyBundle,
  governed: GovernedAction,
  refreshed: SpctreCliConfig,
  harness: HookHarness,
  toolName: string,
  mode: HookMode,
  shadowMode: boolean,
  toolParameters: Record<string, unknown> | undefined,
): Promise<{ result: EvaluationResult; evidencePayload: AgtRuntimeDecisionInput }> {
  const kernel = await loadPortablePolicyKernel();
  const t0 = Date.now();
  const result = kernel.evaluatePolicyDecision({
    connector: governed.connector,
    action: governed.action,
    domains: governed.domains ?? [],
    rules: bundle.rules,
    toolParameters: toolParameters ?? {},
  });
  const latencyMs = Date.now() - t0;

  const decisionId = `${toolName}-${Date.now()}`;

  if (shadowMode) {
    appendShadowLog({
      decisionId,
      connector: governed.connector,
      action: governed.action,
      outcome: result.status,
      matchedRules: result.matchedRefs,
      artifactHash: refreshed.artifactHash,
      timestamp: new Date().toISOString(),
      reason: result.reason,
    });
  }

  const evidencePayload: AgtRuntimeDecisionInput = {
    decisionId,
    tenantId: refreshed.tenantId,
    workspaceId: refreshed.workspaceId,
    environment: refreshed.environment,
    runtimeTarget: { stack: "LOCAL", adapter: adapterForHarness(harness) },
    agentId: refreshed.agentId,
    connector: governed.connector,
    action: governed.action,
    status: result.status,
    reason: result.reason,
    policyRefs: result.matchedRefs,
    artifactHash: refreshed.artifactHash,
    policyContext: refreshed.policyContext,
    latencyMs,
    toolParameters,
    createdAt: new Date().toISOString(),
    rawEvidence: {
      harness,
      tool: toolName,
      enforcementMode: shadowMode ? "shadow" : mode,
      shadowMode,
    },
  };

  return { result, evidencePayload };
}

export async function pretooluse(options: PreToolUseOptions = {}): Promise<void> {
  const raw = await readStdin();
  const harness = currentHarness(options);
  activeHarness = harness;
  const mode = parseHookMode(options);

  let payload: PreToolUseHookPayload;
  try {
    payload = JSON.parse(raw) as PreToolUseHookPayload;
  } catch {
    return emitAllowDecision(); // malformed — allow
  }

  const toolName = payload.tool_name ?? payload.toolCall?.name;
  const toolInput = payload.tool_input ?? payload.toolCall?.args ?? {};
  if (!toolName) return emitAllowDecision(); // unknown hook payload — allow

  const config = readConfig();
  if (!config) return emitAllowDecision(); // not initialized — allow

  // Classify first, before any async work or disk I/O
  const governed = resolveGovernedAction(toolName, toolInput);

  // Fast path: ungoverned tool (Read, Edit, Write, TodoWrite, etc.)
  // No network calls. Exit immediately.
  if (!governed) return emitAllowDecision();

  // Governed path: refresh token (usually a local no-op check)
  const refreshed = await refreshIfNeeded(config);

  // Load bundle — if missing, allow but still send heartbeat
  const bundle = loadPolicyBundle(refreshed);

  if (!bundle) {
    // No bundle: send heartbeat (best-effort, 500ms cap) and allow
    await withTimeout(
      postEvidence(refreshed, buildHeartbeatPayload(refreshed, toolName, harness, mode)).catch(
        () => {},
      ),
      500,
    );
    return emitAllowDecision();
  }

  const shadowMode = isShadowModeActive();
  const sanitizedToolParameters = filterGatewayToolParameters(toolInput);
  const { result, evidencePayload } = await evaluateLocalDecision(
    bundle,
    governed,
    refreshed,
    harness,
    toolName,
    mode,
    shadowMode,
    sanitizedToolParameters,
  );

  const heartbeat = postEvidence(
    refreshed,
    buildHeartbeatPayload(refreshed, toolName, harness, mode),
  ).catch(() => {});
  const evidence = postEvidence(refreshed, evidencePayload).catch(() => {});

  // Gateway integration: if configured, evaluate governed actions via cloud gateway
  const gwConfig = clampGatewayConfigForHarness(resolveGatewayConfig(refreshed, mode), harness);
  if (gwConfig && !shadowMode) {
    const flow = await runGatewayFlow(gwConfig, {
      refreshed,
      governed,
      toolInput,
      payload,
      evidencePayload,
      heartbeat,
      evidence,
    });
    if (flow === "allow") return emitAllowDecision();
  }

  // Shadow mode: never block; log to stderr so the user sees it in their harness output
  if (shadowMode) {
    const ruleSuffix = result.matchedRefs.length > 0 ? ` (${result.matchedRefs[0]})` : "";
    console.error(
      `[shadow] ${governed.connector}.${governed.action} → ${result.status}${ruleSuffix}`,
    );
    await withTimeout(Promise.all([heartbeat, evidence]), 500);
    return emitAllowDecision();
  }

  if (shouldBlockDecision(mode, result.status)) {
    // Wait up to 2s so the block is captured in the audit trail before exiting
    await withTimeout(Promise.all([heartbeat, evidence]), 2000);
    blockAndExit(`Spctre policy DENY: ${result.reason}`, result.reason);
  }

  if (mode === "observe" && (result.status === "DENY" || result.status === "WARN")) {
    console.error(`Spctre observe ${result.status}: ${result.reason}`);
  } else if (mode === "enforce" && result.status === "WARN") {
    console.error(`Spctre policy WARN: ${result.reason}`);
  }

  // ALLOW / WARN: give network calls 500ms then exit — bounded latency
  await withTimeout(Promise.all([heartbeat, evidence]), 500);
  emitAllowDecision();

  // Flush buffer in background without blocking CLI termination
  flushBuffer(refreshed).catch(() => {});
}
