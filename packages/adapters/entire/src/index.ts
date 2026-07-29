import { execFileSync } from "node:child_process";

type CheckpointStatus = "ALLOW" | "DENY" | "WARN" | "ESCALATE";

interface EntireSessionMetadata {
  checkpoint_id: string;
  session_id?: string;
  created_at: string;
  branch?: string;
  files_touched?: string[];
  agent?: string;
  model?: string;
  strategy?: string;
  kind?: string;
  token_usage?: Record<string, number>;
  initial_attribution?: { agent_percentage?: number };
}

export interface EntireCheckpointAdapterOptions {
  apiKey: string;
  /** Spctre origin or API v1 base URL, e.g. https://app.spctre.dev/api/v1. */
  baseUrl: string;
  repositoryId: string;
  environment: string;
  branch?: string;
  agentId?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * Called for each checkpoint that cannot be read or validated, instead of
   * dropping it silently. Defaults to a `console.warn`. Accumulate these in your
   * own callback if you need a skipped count or partial-ingestion report.
   */
  onSkip?: (skip: EntireCheckpointSkip) => void;
}

export interface EntireCheckpointSkip {
  /** Repo-relative path of the checkpoint's metadata.json. */
  path: string;
  /** `unreadable`: Git object read failed. `invalid-json`: metadata.json did not parse. `missing-fields`: required fields absent. */
  reason: "unreadable" | "invalid-json" | "missing-fields";
  detail: string;
}

export interface EntireIngestResult {
  checkpointId: string;
  sessionId: string;
  status: CheckpointStatus;
}

const SENSITIVE_PATH = [/\.env(\.|$)/i, /\.secret/i, /secrets?\//i, /credentials?\//i, /private[_-]?key/i, /id_rsa/, /\.(pem|key|p12|pfx)$/i];
const SAFE_REF = /^[\w./-]+$/;
const KNOWN_AGENTS = new Set(["claude-code", "codex", "cursor", "gemini-cli", "antigravity-cli", "antigravity", "github-copilot", "windsurf"]);

/**
 * Reads Entire's checkpoint branch and submits normalized checkpoints to the
 * public Git checkpoint endpoint. This package deliberately owns Entire's
 * private branch layout; the core Spctre CLI and server do not.
 */
export async function ingestEntireCheckpoints(options: EntireCheckpointAdapterOptions): Promise<EntireIngestResult[]> {
  const branch = options.branch ?? "entire/checkpoints/v1";
  if (!SAFE_REF.test(branch) || branch.startsWith("-")) throw new Error(`Unsafe Git ref: ${branch}`);

  const onSkip = options.onSkip ?? ((skip: EntireCheckpointSkip) => console.warn(`[entire-checkpoints] skipped ${skip.path}: ${skip.reason} — ${skip.detail}`));
  const headCommit = git(["rev-parse", branch]).trim();
  const checkpoints = readCheckpoints(branch, onSkip);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/evidence/git-checkpoints`;
  const results: EntireIngestResult[] = [];

  for (const metadata of checkpoints) {
    const sessionId = metadata.session_id ?? metadata.checkpoint_id;
    const status = statusFor(metadata);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        idempotencyKey: `entire:${options.repositoryId}:${metadata.checkpoint_id}`,
        environment: options.environment,
        status,
        reason: reasonFor(metadata, status),
        agent: { id: options.agentId ?? `entire/${slug(metadata.agent)}`, adapter: "entire-checkpoints" },
        connector: "entire-session",
        action: `session.${metadata.kind ?? "standard"}`,
        checkpoint: {
          id: metadata.checkpoint_id,
          createdAt: metadata.created_at,
          repository: { id: options.repositoryId },
          ref: metadata.branch ?? branch,
          headCommit,
          diff: metadata.files_touched?.length
            ? { format: "name-status", files: metadata.files_touched.map((path) => ({ path, status: "modified" })) }
            : { format: "none" },
        },
        metadata: { source: "entire", sessionId, agent: metadata.agent, model: metadata.model, strategy: metadata.strategy, tokenUsage: metadata.token_usage, agentPercentage: metadata.initial_attribution?.agent_percentage },
      }),
    });
    if (!response.ok) throw new Error(`Spctre Git checkpoint ingest failed: ${response.status} ${await response.text()}`);
    results.push({ checkpointId: metadata.checkpoint_id, sessionId, status });
  }
  return results;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 });
}

function readCheckpoints(branch: string, onSkip: (skip: EntireCheckpointSkip) => void): EntireSessionMetadata[] {
  const paths = git(["ls-tree", "-r", "--name-only", branch]).trim().split("\n");
  return paths
    .filter((path) => path.endsWith("/metadata.json") && path.split("/").length === 4)
    .flatMap((path) => {
      let raw: string;
      try {
        raw = git(["show", `${branch}:${path}`]);
      } catch (error) {
        onSkip({ path, reason: "unreadable", detail: errorMessage(error) });
        return [];
      }
      let metadata: EntireSessionMetadata;
      try {
        metadata = JSON.parse(raw) as EntireSessionMetadata;
      } catch (error) {
        onSkip({ path, reason: "invalid-json", detail: errorMessage(error) });
        return [];
      }
      if (!metadata.checkpoint_id || !metadata.created_at) {
        onSkip({ path, reason: "missing-fields", detail: "checkpoint_id and created_at are required" });
        return [];
      }
      return [metadata];
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusFor(metadata: EntireSessionMetadata): CheckpointStatus {
  if (!metadata.agent) return "DENY";
  if ((metadata.files_touched ?? []).some((path) => SENSITIVE_PATH.some((pattern) => pattern.test(path))) || !KNOWN_AGENTS.has(slug(metadata.agent)) || (metadata.initial_attribution?.agent_percentage ?? 0) > 80) return "WARN";
  return "ALLOW";
}

function reasonFor(metadata: EntireSessionMetadata, status: CheckpointStatus): string {
  if (status === "DENY") return "Session record has no agent attribution — provenance cannot be established.";
  if (status === "WARN") return "Entire checkpoint requires review because it has sensitive paths, an unknown agent, or high AI authorship.";
  return "Entire checkpoint passed pre-deployment governance checks.";
}

function slug(agent: string | undefined): string {
  return agent?.toLowerCase().trim().replace(/\s+/g, "-") || "unknown";
}
