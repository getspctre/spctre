#!/usr/bin/env node
import { Command } from "commander";
import { SPCTRE_VERSION } from "./version.js";

const program = new Command();

program
  .name("spctre")
  .description("Control plane CLI for governed agent systems")
  .version(SPCTRE_VERSION)
  .option(
    "--non-interactive",
    "disable all prompts; fail fast on missing inputs (auto-set when CI=true)",
  );

program
  .command("init")
  .description("Connect a solo developer agent in under one minute")
  .option("-w, --workspace <workspace>", "workspace slug", "default")
  .option("-a, --agent <agent>", "agent id", "solo-agent")
  .option("-e, --environment <environment>", "runtime environment", "production")
  .option("-o, --output <path>", "output path", "spctre-policy.json")
  .option("-u, --url <url>", "control plane URL", "http://localhost:3000")
  .option("-t, --timeout <seconds>", "approval timeout in seconds", "60")
  .option("--token <key>", "service account API key (skips browser approval)")
  .option("--device", "use RFC 8628 device code flow (no browser redirect required)")
  .option("--no-open", "skip auto-opening the browser approval page")
  .action(async (options) => {
    const { init } = await import("./init.js");
    await init(options);
  });

program
  .command("sync")
  .description("Fetch the latest approved policy bundle for a workspace")
  .option("-w, --workspace <workspace>", "workspace id")
  .option("-k, --key <key>", "control plane API key")
  .option("-o, --output <path>", "output path")
  .option("-u, --url <url>", "control plane URL", "http://localhost:3000")
  .action(async (options) => {
    const { sync } = await import("./sync.js");
    const result = await sync(options);
    if (result && !result.published) {
      console.log(
        "No policy bundle has been published for this workspace yet. Nothing to sync — publish a revision, then run this again.",
      );
    }
  });

const bundleCommand = program
  .command("bundle")
  .description("Inspect and export published policy bundles");

bundleCommand
  .command("preview")
  .description("Preview all supported bundle export targets and blocking warnings")
  .option("-w, --workspace <workspace>", "workspace id")
  .option("-k, --key <key>", "control plane API key")
  .option("-u, --url <url>", "control plane URL", "http://localhost:3000")
  .option("--output <format>", "output format: text (default) or json")
  .option("--strict", "exit non-zero when any target is blocked")
  .action(async (options) => {
    const { bundlePreview } = await import("./bundle-export.js");
    await bundlePreview(options);
  });

bundleCommand
  .command("export")
  .description("Export the latest published bundle to a target artifact plus manifest sidecar")
  .requiredOption(
    "--format <format>",
    "export format: spctre-json, opa-rego, opa-bundle, cedar, or mcp-proxy-config",
  )
  .option("-w, --workspace <workspace>", "workspace id")
  .option("-k, --key <key>", "control plane API key")
  .option("-o, --output <path>", "artifact output path")
  .option("--manifest-output <path>", "manifest output path (default: <output>.manifest.json)")
  .option("-u, --url <url>", "control plane URL", "http://localhost:3000")
  .option("-q, --quiet", "suppress output except errors")
  .action(async (options) => {
    const { bundleExport } = await import("./bundle-export.js");
    await bundleExport(options);
  });

bundleCommand
  .command("verify")
  .description("Verify a bundle export artifact against its manifest sidecar")
  .requiredOption("--artifact <path>", "artifact path")
  .requiredOption("--manifest <path>", "manifest sidecar path")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { bundleVerify } = await import("./bundle-export.js");
    await bundleVerify(options);
  });

bundleCommand
  .command("run-verifiers")
  .description(
    "Run target-native verifier tools (opa check, cedar validate, etc.) against a local export artifact",
  )
  .requiredOption("--artifact <path>", "artifact path")
  .requiredOption("--manifest <path>", "manifest sidecar path")
  .option("--output <format>", "output format: text (default) or json")
  .option(
    "--allow-missing-tools",
    "treat missing verifier tools as skipped instead of failing (useful for local dev)",
  )
  .action(async (options) => {
    const { bundleRunVerifiers } = await import("./bundle-export.js");
    await bundleRunVerifiers(options);
  });

program
  .command("ingest")
  .description("Ingest runtime evidence")
  .option("-a, --agent <agent>", "agent id")
  .option("-w, --workspace <workspace>", "workspace id")
  .option("-k, --key <key>", "control plane API key")
  .option("--hash <hash>", "artifact hash for heartbeat evidence")
  .option("--heartbeat", "send heartbeat evidence")
  .option("-e, --environment <environment>", "runtime environment")
  .option("-p, --payload <json>", "raw AGT-compatible evidence payload")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { ingest } = await import("./ingest.js");
    await ingest(options);
  });

const apiCommand = program
  .command("api")
  .description("Call documented Spctre public REST API v1 operations");

apiCommand
  .command("request <method> <path>")
  .description("Call a public v1 endpoint; path is relative to /api/v1")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-d, --data <json>", "request body")
  .option("-f, --file <path>", "request body file")
  .option("-o, --output-file <path>", "write the response body to a file")
  .option("-H, --header <header...>", "additional header (Name: value)")
  .option("-q, --query <key=value...>", "query parameter; may be repeated")
  .option("--yes", "confirm a DELETE request")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (method: string, path: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method, path, ...options });
  });

function addApiReadCommand(parent: Command, name: string, path: string, description: string): void {
  parent
    .command(name)
    .description(description)
    .option("-k, --key <key>", "service account API key")
    .option("-u, --url <url>", "control plane URL")
    .option("-q, --query <key=value...>", "query parameter; may be repeated")
    .option("-o, --output-file <path>", "write the response body to a file")
    .option("--output <format>", "output format: text (default) or json")
    .action(async (options) => {
      const { apiRequest } = await import("./api.js");
      await apiRequest({ method: "GET", path, ...options });
    });
}

function addApiWriteCommand(
  parent: Command,
  name: string,
  path: string,
  description: string,
  options: { method?: "POST" | "DELETE"; allowEmptyBody?: boolean; sensitive?: boolean } = {},
): void {
  const method = options.method ?? "POST";
  const command = parent
    .command(name)
    .description(description)
    .option("-k, --key <key>", "service account API key")
    .option("-u, --url <url>", "control plane URL")
    .option("-d, --data <json>", "request body")
    .option("-f, --file <path>", "request body file")
    .option("-H, --header <header...>", "additional header (Name: value)")
    .option("--output <format>", "output format: text (default) or json");
  if (options.sensitive || method === "DELETE") {
    command.option("--yes", "confirm this sensitive operation");
  }
  command.action(async (commandOptions) => {
    if (
      !options.allowEmptyBody &&
      method === "POST" &&
      !commandOptions.data &&
      !commandOptions.file
    ) {
      console.error("Error: provide the request body with --data or --file.");
      process.exit(1);
    }
    if (options.sensitive && !commandOptions.yes) {
      console.error("Error: this sensitive operation requires --yes.");
      process.exit(1);
    }
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method, path, ...commandOptions });
  });
}

apiCommand
  .command("evaluate")
  .description("Simulate a decision against the published policy bundle")
  .requiredOption("-d, --data <json>", "EvaluateRequest JSON")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "POST", path: "/evaluate", ...options });
  });

const reviewCommand = apiCommand.command("review").description("Review and escalation operations");
for (const [name, path] of [
  ["approvals", "/approvals/queue"],
  ["escalations", "/gateway/escalations"],
] as const) {
  reviewCommand
    .command(name)
    .description(`List ${name} visible to the credential`)
    .option("-k, --key <key>", "service account API key")
    .option("-u, --url <url>", "control plane URL")
    .option("-q, --query <key=value...>", "query parameter; may be repeated")
    .option("--output <format>", "output format: text (default) or json")
    .action(async (options) => {
      const { apiRequest } = await import("./api.js");
      await apiRequest({ method: "GET", path, ...options });
    });
}

reviewCommand
  .command("approval <id>")
  .description("Get one approval")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (id: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "GET", path: `/approvals/${encodeURIComponent(id)}`, ...options });
  });

reviewCommand
  .command("resolve")
  .description("Resolve a gateway escalation")
  .requiredOption("-d, --data <json>", "Gateway resolution JSON")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "POST", path: "/gateway/resolve", ...options });
  });
reviewCommand
  .command("decide")
  .description("Evaluate a gateway decision")
  .requiredOption("-d, --data <json>", "Gateway decision JSON")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "POST", path: "/gateway/decide", ...options });
  });
reviewCommand
  .command("status <decisionId>")
  .description("Get an escalation's gateway decision status")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (decisionId: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "GET",
      path: `/gateway/escalations/status?decisionId=${encodeURIComponent(decisionId)}`,
      ...options,
    });
  });

const complianceCommand = apiCommand
  .command("compliance")
  .description("Compliance reporting operations");
for (const [name, path, description] of [
  ["status", "/compliance/status", "Report published compliance packet status"],
  ["export", "/compliance/export", "Export the current compliance packet"],
] as const) {
  complianceCommand
    .command(name)
    .description(description)
    .option("-k, --key <key>", "service account API key")
    .option("-u, --url <url>", "control plane URL")
    .option("-q, --query <key=value...>", "query parameter; may be repeated")
    .option("--output <format>", "output format: text (default) or json")
    .action(async (options) => {
      const { apiRequest } = await import("./api.js");
      await apiRequest({ method: "GET", path, ...options });
    });
}

const verificationCommand = apiCommand
  .command("verification")
  .description("Record and inspect policy verification results");
verificationCommand
  .command("list")
  .description("List verification results")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-q, --query <key=value...>", "query parameter; may be repeated")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "GET", path: "/verification", ...options });
  });
verificationCommand
  .command("ingest")
  .description("Record a verification result")
  .requiredOption("-d, --data <json>", "VerificationIngestRequest JSON")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "POST", path: "/verification", ...options });
  });

const operationsCommand = apiCommand
  .command("operations")
  .description("Inspect workspaces, members, workflow, and governed agents");
for (const [name, path, description] of [
  ["workspaces", "/workspaces", "List accessible workspaces"],
  ["members", "/members", "List active-workspace members"],
  ["workflow", "/workflow/config", "Read review workflow configuration"],
] as const) {
  operationsCommand
    .command(name)
    .description(description)
    .option("-k, --key <key>", "service account API key")
    .option("-u, --url <url>", "control plane URL")
    .option("-q, --query <key=value...>", "query parameter; may be repeated")
    .option("--output <format>", "output format: text (default) or json")
    .action(async (options) => {
      const { apiRequest } = await import("./api.js");
      await apiRequest({ method: "GET", path, ...options });
    });
}
operationsCommand
  .command("agent-audit <id>")
  .description("Summarize one agent's governed decisions")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-q, --query <key=value...>", "query parameter; may be repeated")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (id: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "GET",
      path: `/agents/${encodeURIComponent(id)}/audit`,
      ...options,
    });
  });
operationsCommand
  .command("trust-history <agentId>")
  .description("List an agent's trust-score history")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-q, --query <key=value...>", "query parameter; may be repeated")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (agentId: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "GET",
      path: `/trust/history?agentId=${encodeURIComponent(agentId)}`,
      ...options,
    });
  });
operationsCommand
  .command("identity-events")
  .description("List identity lifecycle events")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-q, --query <key=value...>", "query parameter; may be repeated")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({ method: "GET", path: "/identity/events", ...options });
  });

const evidenceCommand = apiCommand
  .command("evidence")
  .description("Ingest, retain, export, and attest governance evidence");

for (const [name, path, description] of [
  ["generic-json", "/ingest/providers/generic_json", "Ingest mapped generic JSON evidence"],
  ["generic-ndjson", "/ingest/providers/generic_ndjson", "Ingest mapped NDJSON evidence"],
  [
    "docker-ai-governance",
    "/ingest/providers/docker_ai_governance",
    "Ingest Docker AI Governance evidence",
  ],
  ["cloudevent", "/ingest/cloudevents", "Ingest a CloudEvent"],
  ["otlp-logs", "/logs", "Ingest OTLP/HTTP JSON logs"],
  ["mcp-event", "/gateway-ingest/mcp", "Ingest an MCP gateway event"],
  ["agt-escalation", "/gateway/escalations/agt", "Register an AGT escalation request"],
  ["git-checkpoint", "/evidence/git-checkpoints", "Ingest a Git checkpoint and diff"],
  ["policy-artifact-retain", "/evidence/policy-artifacts", "Retain exact policy artifact bytes"],
  [
    "publication-artifact-retain",
    "/evidence/publication-artifacts",
    "Retain exact publication artifact bytes",
  ],
  ["publication-attest", "/evidence/publications", "Ingest immutable publication facts"],
  [
    "signing-key-challenge",
    "/evidence/publication-signing-keys/challenges",
    "Create a signing-key possession challenge",
  ],
] as const) {
  addApiWriteCommand(evidenceCommand, name, path, description);
}

for (const [name, path, description] of [
  [
    "policy-artifact <contentHash>",
    "/evidence/policy-artifacts",
    "Read a retained policy artifact",
  ],
  [
    "publication-artifact <hash>",
    "/evidence/publication-artifacts",
    "Export a retained publication artifact",
  ],
  ["publications", "/evidence/publications", "List immutable publication attestations"],
  ["signing-keys", "/evidence/publication-signing-keys", "List trusted publication signing keys"],
  ["forensic", "/evidence/forensic", "Query forensic archival evidence (Cloud)"],
] as const) {
  if (name.includes("<")) continue;
  addApiReadCommand(evidenceCommand, name, path, description);
}

evidenceCommand
  .command("policy-artifact <contentHash>")
  .description("Read a retained policy artifact")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-o, --output-file <path>", "write artifact bytes to a file")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (contentHash: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "GET",
      path: `/evidence/policy-artifacts/${encodeURIComponent(contentHash)}`,
      ...options,
    });
  });
evidenceCommand
  .command("publication-artifact <hash>")
  .description("Export a retained publication artifact")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("-o, --output-file <path>", "write artifact bytes to a file")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (hash: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "GET",
      path: `/evidence/publication-artifacts/${encodeURIComponent(hash)}`,
      ...options,
    });
  });
evidenceCommand
  .command("publication <id>")
  .description("Get an immutable publication attestation")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (id: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "GET",
      path: `/evidence/publications/${encodeURIComponent(id)}`,
      ...options,
    });
  });
addApiWriteCommand(
  evidenceCommand,
  "signing-key-enroll",
  "/evidence/publication-signing-keys",
  "Enroll or rotate an ownership-verified publication signing key",
  { sensitive: true },
);
evidenceCommand
  .command("signing-key-revoke <id>")
  .description("Revoke an enrolled publication signing key")
  .option("-k, --key <key>", "service account API key")
  .option("-u, --url <url>", "control plane URL")
  .requiredOption("--yes", "confirm signing-key revocation")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (id: string, options) => {
    const { apiRequest } = await import("./api.js");
    await apiRequest({
      method: "DELETE",
      path: `/evidence/publication-signing-keys/${encodeURIComponent(id)}`,
      ...options,
    });
  });

const trustCommand = apiCommand.command("trust").description("Trust and context-budget governance");
addApiReadCommand(
  trustCommand,
  "history",
  "/trust/history",
  "List trust-score history; pass agentId with --query",
);
for (const [name, path, description] of [
  ["ingest", "/trust/ingest", "Ingest a trust-score observation"],
  ["evaluate", "/trust/evaluate", "Evaluate trust governance"],
  ["context-budget", "/trust/context-budget", "Ingest context-budget telemetry"],
] as const) {
  addApiWriteCommand(trustCommand, name, path, description);
}

const custodyCommand = apiCommand
  .command("custody")
  .description("Retain byte-exact published policy bundle custody");
addApiWriteCommand(
  custodyCommand,
  "retain",
  "/bundle/latest/custody",
  "Retain exact bytes of the latest published policy bundle",
  { allowEmptyBody: true },
);

const scimCommand = apiCommand.command("scim").description("SCIM 2.0 user provisioning (Cloud)");
addApiReadCommand(scimCommand, "users", "/scim/v2/Users", "List SCIM users");
addApiWriteCommand(scimCommand, "create-user", "/scim/v2/Users", "Create a SCIM user");

program
  .command("watch")
  .description("Continuously sync the latest approved policy bundle")
  .option("-w, --workspace <workspace>", "workspace id")
  .option("-k, --key <key>", "control plane API key")
  .option("-o, --output <path>", "output path")
  .option("-u, --url <url>", "control plane URL")
  .option("-i, --interval <seconds>", "poll interval in seconds", "30")
  .option("--heartbeat", "also send a heartbeat on each sync cycle")
  .option(
    "--heartbeat-interval <seconds>",
    "heartbeat interval in seconds (default: same as --interval)",
    "30",
  )
  .option("-q, --quiet", "suppress output except on policy changes and errors")
  .option(
    "--shadow",
    "evaluate decisions against policy but never block; log to .spctre/shadow-log.jsonl",
  )
  .option(
    "--framework <name>",
    "write a zero-change framework adapter (crewai, langchain, openai-agents, autogen, google-adk, strands, notion-worker, antigravity-sdk, claude-agent-sdk, omnigent) to .spctre/ and print launch instructions",
  )
  .action(async (options) => {
    const { watch } = await import("./watch.js");
    await watch(options);
  });

program
  .command("verify-env")
  .description(
    "Verify that a generated framework adapter is active in the current Python environment",
  )
  .requiredOption(
    "--framework <name>",
    "framework adapter to verify: crewai, langchain, openai-agents, autogen, google-adk, strands, notion-worker, antigravity-sdk, claude-agent-sdk, omnigent",
  )
  .option("--python <command>", "Python executable to run through .spctre/spctre-python", "python")
  .action(async (options) => {
    const { verifyEnv } = await import("./verify-env.js");
    await verifyEnv(options);
  });

program
  .command("status")
  .description("Show the current CLI configuration and agent connection state")
  .option("--check", "ping the control plane to verify token and connectivity")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { status } = await import("./status.js");
    await status(options);
  });

const configCommand = program.command("config").description("Manage local Spctre CLI preferences");

configCommand
  .command("set <key> <value>")
  .description("Set a persistent CLI preference")
  .action(async (key: string, value: string) => {
    const { configSet } = await import("./config-command.js");
    await configSet(key, value);
  });

program
  .command("install-skill")
  .description(
    "Install the Spctre SKILL.md for Claude Code, Codex, Gemini, Antigravity CLI, or Kimi Code agents",
  )
  .option(
    "--harness <harness>",
    "agent harness to install for: claude, codex, gemini, antigravity (agy), or kimi",
    "claude",
  )
  .option("--claude", "install for Claude Code")
  .option("--codex", "install for Codex")
  .option("--gemini", "install for Gemini CLI")
  .option("--antigravity", "install for Antigravity CLI (agy)")
  .option("--kimi", "install for Kimi Code CLI")
  .option(
    "-g, --global",
    "install to the harness global skills directory instead of the current project",
  )
  .option("-f, --force", "overwrite an existing installation")
  .action(async (options) => {
    const { installSkill } = await import("./install-skill.js");
    await installSkill(options);
  });

program
  .command("install-hook")
  .description(
    "Install optional local harness adapter for evidence capture; use --enforce for local blocking",
  )
  .option(
    "--harness <harness>",
    "agent harness to install for: claude, codex, gemini, antigravity (agy), or kimi",
    "claude",
  )
  .option("--claude", "install for Claude Code")
  .option("--codex", "install for Codex")
  .option("--gemini", "install for Gemini CLI")
  .option("--antigravity", "install for Antigravity CLI (agy)")
  .option("--kimi", "install for Kimi Code CLI")
  .option("-g, --global", "install to the harness global config instead of the current project")
  .option("--mode <mode>", "hook adapter mode: observe or enforce", "observe")
  .option("--enforce", "install in enforce mode, blocking locally on DENY")
  .option("--uninstall", "remove the hook instead of installing it")
  .action(async (options) => {
    const { installHook } = await import("./install-hook.js");
    await installHook(options);
  });

program
  .command("pretooluse")
  .description("Local harness hook handler for observe/enforce adapter modes")
  .option(
    "--harness <harness>",
    "agent harness that invoked the hook: claude, codex, gemini, antigravity (agy), or kimi",
    "claude",
  )
  .option("--mode <mode>", "hook adapter mode: observe or enforce", "observe")
  .option("--enforce", "run in enforce mode, blocking locally on DENY")
  .action(async (options) => {
    const { pretooluse } = await import("./pretooluse.js");
    await pretooluse(options);
  });

program
  .command("lint [policy]")
  .description(
    "Validate policy file for syntax errors, unknown connectors, dead rules, and conflict shadows",
  )
  .option("--offline", "skip catalog-aware checks; run syntax and shadow-conflict checks only")
  .option("--strict", "exit non-zero on warnings in addition to errors")
  .option("--format <format>", "output format: text (default) or json")
  .option("-u, --url <url>", "control plane URL (overrides config)")
  .action(
    async (
      policy: string | undefined,
      options: { offline: boolean; strict: boolean; format?: string; url?: string },
    ) => {
      const { lint } = await import("./lint.js");
      await lint(policy, options);
    },
  );

program
  .command("test [policy]")
  .description("Run a policy file against test fixtures and assert expected outcomes")
  .requiredOption("-t, --tests <file>", "path to fixtures JSON file")
  .option("--format <format>", "output format: text (default) or json")
  .action(async (policy: string | undefined, options: { tests: string; format?: string }) => {
    const { testCmd } = await import("./test-cmd.js");
    await testCmd(policy, options);
  });

program
  .command("revoke")
  .description("Revoke the current agent tokens and disconnect from the control plane")
  .option("--output <format>", "output format: text (default) or json")
  .action(async (options) => {
    const { revoke } = await import("./revoke.js");
    await revoke(options);
  });

program
  .command("check [policy]")
  .description("Sync, lint, and test a policy bundle; emit SARIF for GitHub Code Scanning")
  .option("--output <format>", "output format: text (default), json, or sarif")
  .option("-t, --tests <file>", "path to fixtures JSON file for policy tests")
  .option("--no-sync", "skip bundle sync; use local policy file as-is")
  .option("-w, --workspace <workspace>", "workspace id override")
  .action(
    async (
      policy: string | undefined,
      options: { output?: string; tests?: string; noSync?: boolean; workspace?: string },
    ) => {
      const { check } = await import("./check.js");
      await check(policy, options);
    },
  );

const packCommand = program.command("pack").description("Manage connector governance packs");

packCommand
  .command("scaffold [name]")
  .description("Generate a new connector pack template")
  .option("-o, --output <dir>", "output directory path")
  .option("-c, --connector <id>", "connector identifier")
  .option("-v, --version <version>", "initial pack version", "1.0.0")
  .action(
    async (
      name: string | undefined,
      options: { output?: string; connector?: string; version: string },
    ) => {
      const { packScaffold } = await import("./pack-scaffold.js");
      await packScaffold(name, options);
    },
  );

const policyCommand = program
  .command("policy")
  .description("Author and import policy sources with an operator/CI identity");

policyCommand
  .command("import [file]")
  .description(
    "Import a local policy file into the control plane (operator/CI only; drafts a branch — never approves or publishes)",
  )
  .option("-b, --branch <name>", "branch name (defaults to the connector, then the file name)")
  .option("-c, --connector <id>", "connector id; sets scope to CONNECTOR unless --scope is given")
  .option("--scope <scope>", "branch scope: WORKSPACE, CONNECTOR, ENVIRONMENT, or ORGANIZATION")
  .option("-e, --environment <environment>", "environment (required for ENVIRONMENT scope)")
  .option(
    "-w, --workspace <workspace>",
    "advisory target workspace (the token's workspace is authoritative)",
  )
  .option("--source-path <path>", "provenance source path recorded with the revision")
  .option("--source-format <format>", "source format: AGT_YAML, OPA_REGO, or CEDAR")
  .option("--dry-run", "convert and validate without creating a draft revision")
  .option("--offline", "convert locally without contacting the control plane or creating a revision")
  .option("-o, --output <path>", "offline mode: write the generated AGT-compatible JSON document")
  .option("--report <path>", "offline mode: write the conversion report JSON")
  .option("-k, --key <key>", "operator/CI service key carrying the policy:import scope")
  .option("-u, --url <url>", "control plane URL")
  .option("--format <format>", "output format: text (default) or json")
  .action(async (file: string | undefined, options) => {
    const { policyImport } = await import("./policy-import.js");
    await policyImport(file, options);
  });

policyCommand
  .command("convert [file]")
  .description("Convert a supported Rego or Cedar policy locally without contacting the control plane")
  .option("-o, --output <path>", "write the generated AGT-compatible JSON document")
  .option("--report <path>", "write the conversion report JSON")
  .option("--source-format <format>", "source format: AGT_YAML, OPA_REGO, or CEDAR")
  .option("--format <format>", "output format: text (default) or json")
  .action(async (file: string | undefined, options) => {
    const { policyConvert } = await import("./policy-convert.js");
    await policyConvert(file, options);
  });

const blueprintCommand = program
  .command("blueprint")
  .description("Author and import agent Blueprint sources with an operator/CI identity");

blueprintCommand
  .command("import [file]")
  .description(
    "Import a local Blueprint source into the control plane (operator/CI only; drafts a Blueprint — never approves or publishes)",
  )
  .option(
    "-w, --workspace <workspace>",
    "advisory target workspace (the token's workspace is authoritative)",
  )
  .option("--source-path <path>", "provenance source path recorded with the revision")
  .option("--dry-run", "validate the source locally without importing")
  .option("-k, --key <key>", "operator/CI service key carrying the blueprint:import scope")
  .option("-u, --url <url>", "control plane URL")
  .option("--format <format>", "output format: text (default) or json")
  .action(async (file: string | undefined, options) => {
    const { blueprintImport } = await import("./blueprint-import.js");
    await blueprintImport(file, options);
  });

const cloudCommand = program.command("cloud").description("Manage Spctre Cloud connectivity");

cloudCommand
  .command("login")
  .description("Connect this agent to Spctre Cloud")
  .option("--trial", "request a time-limited free trial token without a credit card")
  .option("-w, --workspace <workspace>", "workspace slug", "default")
  .option("-a, --agent <agent>", "agent id", "solo-agent")
  .option("-e, --environment <environment>", "runtime environment", "production")
  .option("-o, --output <path>", "output path", "spctre-policy.json")
  .option("-u, --url <url>", "control plane URL", "http://localhost:3000")
  .option("-t, --timeout <seconds>", "approval timeout in seconds", "60")
  .option("--no-open", "skip auto-opening the browser approval page")
  .action(async (options) => {
    const { cloudLogin } = await import("./cloud-login.js");
    await cloudLogin(options);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(`Error: ${String(error)}`);
  process.exit(1);
});
