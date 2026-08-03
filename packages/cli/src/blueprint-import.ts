import * as fs from "node:fs";
import * as path from "node:path";
import { parseAgentBlueprintSource } from "@spctre/policy-schema";
import { readConfig } from "./config";
import { getOutputFormat, printJson, printProgress, type OutputFormat } from "./output";

export interface BlueprintImportOptions {
  workspace?: string;
  key?: string;
  url?: string;
  sourcePath?: string;
  dryRun?: boolean;
  format?: string;
}

interface ImportResponse {
  blueprintId: string;
  revisionId: string;
  definitionHash: string;
  created: boolean;
  alreadyCurrent: boolean;
  policyBranchId: string;
  policyRevisionId: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function reportDryRun(envelope: { name: string; agentId: string }, fileBase: string, branch: string, format: OutputFormat): void {
  if (format === "json") {
    printJson({ ok: true, dryRun: true, name: envelope.name, agentId: envelope.agentId, policyBranchId: branch });
    return;
  }
  console.log(`Validated ${fileBase} → Blueprint "${envelope.name}" (agent ${envelope.agentId}).`);
  console.log(
    branch
      ? `  policy branch: ${branch} (published revision resolved server-side at import)`
      : "  warning: no definition.policyBranchId set; the import will reject this source"
  );
  console.log("  dry run: import skipped.");
}

function reportFailure(status: number, message: string, format: OutputFormat): never {
  if (format === "json") {
    printJson({ ok: false, status, error: message });
    process.exit(1);
  }
  fail(`Import failed (${status}): ${message}`);
}

function reportSuccess(payload: ImportResponse, format: OutputFormat): void {
  const status = payload.alreadyCurrent ? "already current" : payload.created ? "created" : "updated";
  if (format === "json") {
    printJson({ ok: true, status, ...payload });
    return;
  }
  console.log(`Blueprint ${status}.`);
  console.log(`  blueprint: ${payload.blueprintId}`);
  console.log(`  revision:  ${payload.revisionId}`);
  console.log(`  policy:    branch ${payload.policyBranchId} @ revision ${payload.policyRevisionId}`);
  if (!payload.alreadyCurrent) {
    console.log("\nThis is an unapproved draft. Review, approve, and publish it in the Spctre control plane.");
  }
}

/**
 * Imports a local Blueprint source into the control plane using an operator/CI
 * service key (the `blueprint:import` scope). This never approves or publishes —
 * it drafts a Blueprint/revision that a human then reviews and publishes in the
 * Spctre UI. The source declares its governing policy branch by name; the import
 * resolves that branch's published revision server-side and fails closed if none.
 * Re-running with an unchanged, same-bound definition is a no-op.
 */
export async function blueprintImport(file: string | undefined, options: BlueprintImportOptions): Promise<void> {
  const format = getOutputFormat(options.format);
  if (!file) fail("Error: a Blueprint source file path is required. Usage: spctre blueprint import <file>");

  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) fail(`Error: Blueprint source not found: ${filePath}`);
  const source = fs.readFileSync(filePath, "utf8");
  const sourcePath = options.sourcePath ?? (path.relative(process.cwd(), filePath) || path.basename(filePath));

  // Local validation — also the entire --dry-run path (offline, no network).
  const parsed = parseAgentBlueprintSource({ document: source, sourcePath });
  if ("error" in parsed) fail(`Error: ${parsed.error}`);
  const { envelope } = parsed;
  const branch = typeof envelope.definition.policyBranchId === "string" ? envelope.definition.policyBranchId.trim() : "";

  if (options.dryRun) {
    reportDryRun(envelope, path.basename(filePath), branch, format);
    return;
  }

  const config = readConfig();
  const key = options.key ?? config?.token;
  if (!key) {
    fail("Error: an operator API key is required. Pass --key (a blueprint:import service key) or run from a configured .spctre directory.");
  }
  const url = (options.url ?? config?.controlPlaneUrl ?? "http://localhost:3000").replace(/\/+$/, "");
  // The token binds the target workspace; --workspace is an advisory assertion
  // echoed for the operator's clarity — it is not authoritative.
  const assertedWorkspace = (options.workspace ?? "").trim();

  printProgress(
    `Importing ${path.basename(filePath)} → Blueprint "${envelope.name}" (agent ${envelope.agentId})` +
      `${assertedWorkspace ? ` into workspace ${assertedWorkspace}` : ""}...`
  );

  const payload = await postImport(url, key, { source, sourcePath }, format);
  reportSuccess(payload, format);
}

/** POSTs the import and returns the payload, exiting on transport or API error. */
async function postImport(url: string, key: string, body: Record<string, unknown>, format: OutputFormat): Promise<ImportResponse> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/blueprint/imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return fail(`Import failed: ${String(error)}`);
  }

  const payload = (await response.json().catch(() => null)) as (ImportResponse & { error?: string }) | null;
  if (!response.ok || !payload || payload.error) {
    reportFailure(response.status, payload?.error ?? `HTTP ${response.status}`, format);
  }
  return payload;
}
