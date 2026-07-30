#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("spctre")
  .description("Control plane CLI for governed agent systems")
  .version("0.1.0")
  .option("--non-interactive", "disable all prompts; fail fast on missing inputs (auto-set when CI=true)");

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
    await sync(options);
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
  .requiredOption("--format <format>", "export format: spctre-json, opa-rego, opa-bundle, cedar, or mcp-proxy-config")
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
  .description("Run target-native verifier tools (opa check, cedar validate, etc.) against a local export artifact")
  .requiredOption("--artifact <path>", "artifact path")
  .requiredOption("--manifest <path>", "manifest sidecar path")
  .option("--output <format>", "output format: text (default) or json")
  .option("--allow-missing-tools", "treat missing verifier tools as skipped instead of failing (useful for local dev)")
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

program
  .command("watch")
  .description("Continuously sync the latest approved policy bundle")
  .option("-w, --workspace <workspace>", "workspace id")
  .option("-k, --key <key>", "control plane API key")
  .option("-o, --output <path>", "output path")
  .option("-u, --url <url>", "control plane URL")
  .option("-i, --interval <seconds>", "poll interval in seconds", "30")
  .option("--heartbeat", "also send a heartbeat on each sync cycle")
  .option("--heartbeat-interval <seconds>", "heartbeat interval in seconds (default: same as --interval)", "30")
  .option("-q, --quiet", "suppress output except on policy changes and errors")
  .option("--shadow", "evaluate decisions against policy but never block; log to .spctre/shadow-log.jsonl")
  .option("--framework <name>", "write a zero-change framework adapter (crewai, langchain, openai-agents, autogen, google-adk, strands, notion-worker, antigravity-sdk, claude-agent-sdk, omnigent) to .spctre/ and print launch instructions")
  .action(async (options) => {
    const { watch } = await import("./watch.js");
    await watch(options);
  });

program
  .command("verify-env")
  .description("Verify that a generated framework adapter is active in the current Python environment")
  .requiredOption("--framework <name>", "framework adapter to verify: crewai, langchain, openai-agents, autogen, google-adk, strands, notion-worker, antigravity-sdk, claude-agent-sdk, omnigent")
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

const configCommand = program
  .command("config")
  .description("Manage local Spctre CLI preferences");

configCommand
  .command("set <key> <value>")
  .description("Set a persistent CLI preference")
  .action(async (key: string, value: string) => {
    const { configSet } = await import("./config-command.js");
    await configSet(key, value);
  });

program
  .command("install-skill")
  .description("Install the Spctre SKILL.md for Claude Code, Codex, Gemini, or Antigravity CLI agents")
  .option("--harness <harness>", "agent harness to install for: claude, codex, gemini, or antigravity (agy)", "claude")
  .option("--claude", "install for Claude Code")
  .option("--codex", "install for Codex")
  .option("--gemini", "install for Gemini CLI")
  .option("--antigravity", "install for Antigravity CLI (agy)")
  .option("-g, --global", "install to the harness global skills directory instead of the current project")
  .option("-f, --force", "overwrite an existing installation")
  .action(async (options) => {
    const { installSkill } = await import("./install-skill.js");
    await installSkill(options);
  });

program
  .command("install-hook")
  .description("Install optional local harness adapter for evidence capture; use --enforce for local blocking")
  .option("--harness <harness>", "agent harness to install for: claude, codex, gemini, or antigravity (agy)", "claude")
  .option("--claude", "install for Claude Code")
  .option("--codex", "install for Codex")
  .option("--gemini", "install for Gemini CLI")
  .option("--antigravity", "install for Antigravity CLI (agy)")
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
  .option("--harness <harness>", "agent harness that invoked the hook: claude, codex, gemini, or antigravity (agy)", "claude")
  .option("--mode <mode>", "hook adapter mode: observe or enforce", "observe")
  .option("--enforce", "run in enforce mode, blocking locally on DENY")
  .action(async (options) => {
    const { pretooluse } = await import("./pretooluse.js");
    await pretooluse(options);
  });


program
  .command("lint [policy]")
  .description("Validate policy file for syntax errors, unknown connectors, dead rules, and conflict shadows")
  .option("--offline", "skip catalog-aware checks; run syntax and shadow-conflict checks only")
  .option("--strict", "exit non-zero on warnings in addition to errors")
  .option("--format <format>", "output format: text (default) or json")
  .option("-u, --url <url>", "control plane URL (overrides config)")
  .action(async (policy: string | undefined, options: { offline: boolean; strict: boolean; format?: string; url?: string }) => {
    const { lint } = await import("./lint.js");
    await lint(policy, options);
  });

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
  .action(async (policy: string | undefined, options: { output?: string; tests?: string; noSync?: boolean; workspace?: string }) => {
    const { check } = await import("./check.js");
    await check(policy, options);
  });

const packCommand = program
  .command("pack")
  .description("Manage connector governance packs");

packCommand
  .command("scaffold [name]")
  .description("Generate a new connector pack template")
  .option("-o, --output <dir>", "output directory path")
  .option("-c, --connector <id>", "connector identifier")
  .option("-v, --version <version>", "initial pack version", "1.0.0")
  .action(async (name: string | undefined, options: { output?: string; connector?: string; version: string }) => {
    const { packScaffold } = await import("./pack-scaffold.js");
    await packScaffold(name, options);
  });

const policyCommand = program
  .command("policy")
  .description("Author and import policy sources with an operator/CI identity");

policyCommand
  .command("import [file]")
  .description("Import a local policy file into the control plane (operator/CI only; drafts a branch — never approves or publishes)")
  .option("-b, --branch <name>", "branch name (defaults to the connector, then the file name)")
  .option("-c, --connector <id>", "connector id; sets scope to CONNECTOR unless --scope is given")
  .option("--scope <scope>", "branch scope: WORKSPACE, CONNECTOR, ENVIRONMENT, or ORGANIZATION")
  .option("-e, --environment <environment>", "environment (required for ENVIRONMENT scope)")
  .option("-w, --workspace <workspace>", "advisory target workspace (the token's workspace is authoritative)")
  .option("--source-path <path>", "provenance source path recorded with the revision")
  .option("-k, --key <key>", "operator/CI service key carrying the policy:import scope")
  .option("-u, --url <url>", "control plane URL")
  .option("--format <format>", "output format: text (default) or json")
  .action(async (file: string | undefined, options) => {
    const { policyImport } = await import("./policy-import.js");
    await policyImport(file, options);
  });

const cloudCommand = program
  .command("cloud")
  .description("Manage Spctre Cloud connectivity");

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
