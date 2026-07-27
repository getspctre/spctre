import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { SpctreCliConfig } from "../config";

const WORKER_FILENAME = "notion-worker.js";
const MANIFEST_FILENAME = "governance-manifest-notion-worker.json";
const AUDIT_NOTE_FILENAME = "GOVERNANCE-NOTION-WORKER.md";
const SPCTRE_DIR = ".spctre";

/**
 * Generates .spctre/notion-worker.js — a Notion Worker template that wraps
 * each agent tool call with a Spctre governance pre-check (evaluate_policy).
 * On ESCALATE the review is surfaced via Notion's built-in approval loop.
 * After execution, evidence is posted via the /api/gateway-ingest/notion endpoint.
 *
 * Deploy with: notion worker deploy .spctre/notion-worker.js
 */
export function writeNotionWorkerAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  const spctreDir = path.resolve(process.cwd(), SPCTRE_DIR);
  fs.mkdirSync(spctreDir, { recursive: true });

  const workerPath = path.join(spctreDir, WORKER_FILENAME);
  const manifestPath = path.join(spctreDir, MANIFEST_FILENAME);
  const auditNotePath = path.join(spctreDir, AUDIT_NOTE_FILENAME);

  const workerSource = renderWorkerTemplate(config);
  const manifest = buildManifest(config, workerSource);

  fs.writeFileSync(workerPath, workerSource, "utf8");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(auditNotePath, renderAuditNote(), "utf8");
  fs.chmodSync(spctreDir, 0o700);
  fs.chmodSync(workerPath, 0o644);
  fs.chmodSync(manifestPath, 0o600);
  fs.chmodSync(auditNotePath, 0o600);

  const launchHint = `notion worker deploy ${SPCTRE_DIR}/${WORKER_FILENAME}`;
  return { adapterPath: workerPath, launchHint };
}

function renderWorkerTemplate(config: SpctreCliConfig): string {
  let source = fs.readFileSync(path.join(__dirname, "templates", WORKER_FILENAME), "utf8");
  const substitutions: Record<string, string> = {
    CONTROL_PLANE_URL: config.controlPlaneUrl,
    TOKEN: config.token,
    WORKSPACE_ID: config.workspaceId,
    AGENT_ID: config.agentId,
    ENVIRONMENT: config.environment,
    ARTIFACT_HASH: config.artifactHash,
  };
  for (const [name, value] of Object.entries(substitutions)) {
    source = source.replaceAll(`"__SPCTRE_${name}__"`, JSON.stringify(value));
    source = source.replaceAll(`__SPCTRE_${name}__`, value);
  }
  return source;
}

function buildManifest(config: SpctreCliConfig, workerSource: string) {
  return {
    schemaVersion: 1,
    generatedBy: "spctre watch --framework notion-worker",
    framework: "notion-worker",
    runtimePatching: false,
    deployCommand: `notion worker deploy ${SPCTRE_DIR}/${WORKER_FILENAME}`,
    workerPath: `${SPCTRE_DIR}/${WORKER_FILENAME}`,
    verificationCommand: `spctre verify-env --framework notion-worker`,
    patchTargets: ["spctreGoverned (inline wrapper around handler tool calls)"],
    evidenceSignals: [
      {
        action: "worker.execute",
        policyRef: "notion-orchestration.worker.execute",
        when: "emitted after each governed Worker tool call",
      },
    ],
    controlPlaneUrl: config.controlPlaneUrl,
    workspaceId: config.workspaceId,
    agentId: config.agentId,
    environment: config.environment,
    artifactHash: config.artifactHash,
    files: {
      workerSha256: sha256(workerSource),
    },
    auditNotes: [
      "This project uses a generated Notion Worker governance template.",
      "Deploy the Worker via: notion worker deploy .spctre/notion-worker.js",
      "The Worker wraps tool calls with spctreGoverned(), which calls evaluate_policy before execution.",
      "On ESCALATE, the Worker returns the Notion approval loop URL to defer execution to a human reviewer.",
      "Evidence is emitted to /api/gateway-ingest/notion after each tool call.",
      "Evidence records carry provenance_gap: true — Notion does not natively emit AGT-compatible evidence.",
      "Replace the placeholder handler logic in notion-worker.js with your actual agent tool calls.",
    ],
  };
}

function renderAuditNote(): string {
  return `# Spctre Governance — Notion Worker

This directory contains the generated Spctre governance layer for Notion Workers.

## Deploy

    notion worker deploy ${SPCTRE_DIR}/${WORKER_FILENAME}

## How it works

The generated Worker wraps every agent tool call with \`spctreGoverned()\`:

1. **Pre-check** — calls \`/api/evaluate\` (evaluate_policy) before execution.
   - ABORT: returns a blocked response; no tool execution.
   - ESCALATE: surfaces the review via Notion's built-in approval loop URL; no tool execution until resolved.
   - PROCEED: continues to step 2.
2. **Execute** — runs your agent tool fn.
3. **Evidence** — posts a \`spctre.gateway.event.v1\` payload to \`/api/gateway-ingest/notion\`.
   Evidence carries \`provenance_gap: true\` because Notion does not natively emit AGT-compatible evidence.

## Customise

Edit the \`handler\` function in \`${WORKER_FILENAME}\` to replace the placeholder tool call with your agent logic:

\`\`\`js
const result = await spctreGoverned({
  agentId: event.agent_id,
  connector: "notion-worker",
  action: "your_tool_name",
  notionApprovalLoopUrl: event.approval_loop_url,
  fn: async () => yourTool(event.input),
});
\`\`\`

## Audit checklist

- Review \`${MANIFEST_FILENAME}\` for evidence signals and file hashes.
- Review \`${WORKER_FILENAME}\` for the governance wrapper logic.
- Confirm evidence with \`gateway:notion\` source appears in the Spctre Evidence ledger after deployment.
`;
}

function sha256(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}
