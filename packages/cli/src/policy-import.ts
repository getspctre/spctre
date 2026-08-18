import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig } from "./config";
import { getOutputFormat, printJson, printProgress, type OutputFormat } from "./output";

export interface PolicyImportOptions {
  branch?: string;
  connector?: string;
  scope?: string;
  environment?: string;
  workspace?: string;
  key?: string;
  url?: string;
  sourcePath?: string;
  format?: string;
  sourceFormat?: "AGT_YAML" | "OPA_REGO" | "CEDAR";
  dryRun?: boolean;
  offline?: boolean;
  output?: string;
  report?: string;
}

interface ImportResponse {
  branchId: string;
  revisionId: string;
  sourceHash: string;
  created: boolean;
  alreadyCurrent: boolean;
  ruleCount: number;
}

/** Derives a branch name from an explicit flag, the connector, or the filename. */
function resolveBranchName(options: PolicyImportOptions, file: string): string {
  const explicit = (options.branch ?? "").trim();
  if (explicit) return explicit;
  const connector = (options.connector ?? "").trim();
  if (connector) return connector;
  return path
    .basename(file)
    .replace(/\.(ya?ml|json|rego|cedar)$/i, "")
    .replace(/[^a-z0-9/-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

interface ResolvedImport {
  url: string;
  key: string;
  body: Record<string, unknown>;
  summary: string;
}

/** Resolves the request from options + config, exiting on missing file/key. */
function resolveImport(file: string, options: PolicyImportOptions): ResolvedImport {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) fail(`Error: policy file not found: ${filePath}`);
  const source = fs.readFileSync(filePath, "utf8");

  const config = readConfig();
  const key = options.key ?? config?.token;
  if (!key) {
    fail(
      "Error: an operator API key is required. Pass --key (a policy:import service key) or run from a configured .spctre directory.",
    );
  }
  const url = (options.url ?? config?.controlPlaneUrl ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  const branchName = resolveBranchName(options, filePath);
  const connector = (options.connector ?? "").trim();
  const scope = (options.scope ?? (connector ? "CONNECTOR" : "WORKSPACE")).trim().toUpperCase();
  const environment = (options.environment ?? "").trim();
  // The token binds the target workspace; --workspace is an advisory assertion
  // echoed for the operator's clarity — it is not authoritative.
  const assertedWorkspace = (options.workspace ?? "").trim();
  const sourcePath =
    options.sourcePath ?? (path.relative(process.cwd(), filePath) || path.basename(filePath));
  const sourceFormat =
    options.sourceFormat ??
    (filePath.endsWith(".rego") ? "OPA_REGO" : filePath.endsWith(".cedar") ? "CEDAR" : undefined);

  const summary =
    `Importing ${path.basename(filePath)} → branch "${branchName}" ` +
    `(scope ${scope}${connector ? `, connector ${connector}` : ""})` +
    `${assertedWorkspace ? ` into workspace ${assertedWorkspace}` : ""}...`;

  return {
    url,
    key,
    summary,
    body: {
      source,
      branchName,
      scope,
      connector: connector || undefined,
      environment: environment || undefined,
      sourcePath,
      sourceFormat,
      dryRun: options.dryRun || undefined,
    },
  };
}

function reportSuccess(payload: ImportResponse, format: OutputFormat): void {
  const status = payload.alreadyCurrent
    ? "already current"
    : payload.created
      ? "created"
      : "updated";
  if (format === "json") {
    printJson({ ok: true, status, ...payload });
    return;
  }
  console.log(`Imported ${payload.ruleCount} rule(s) — branch ${status}.`);
  console.log(`  branch:   ${payload.branchId}`);
  console.log(`  revision: ${payload.revisionId}`);
  console.log(`  source:   ${payload.sourceHash}`);
  if (!payload.alreadyCurrent) {
    console.log(
      "\nThis is an unapproved draft. Review, approve, and publish it in the Spctre control plane.",
    );
  }
}

/**
 * Imports a local policy file into the control plane using an operator/CI
 * service key (the `policy:import` scope). This never approves or publishes —
 * it drafts a branch/revision that a human then reviews and publishes in the
 * Spctre UI. Re-running with unchanged source is a no-op.
 */
export async function policyImport(
  file: string | undefined,
  options: PolicyImportOptions,
): Promise<void> {
  if (options.offline) {
    const { policyConvert } = await import("./policy-convert.js");
    return policyConvert(file, options);
  }
  const format = getOutputFormat(options.format);
  if (!file) fail("Error: a policy file path is required. Usage: spctre policy import <file>");

  const { url, key, body, summary } = resolveImport(file, options);
  printProgress(options.dryRun ? `${summary} (dry run)` : summary);

  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/policy/imports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return fail(`Import failed: ${String(error)}`);
  }

  const payload = (await response.json().catch(() => null)) as
    (ImportResponse & { error?: string }) | null;

  if (!response.ok || !payload || payload.error) {
    const message = payload?.error ?? `HTTP ${response.status}`;
    if (format === "json") {
      printJson({ ok: false, status: response.status, error: message });
      process.exit(1);
    }
    return fail(`Import failed (${response.status}): ${message}`);
  }

  if (options.dryRun) {
    if (format === "json") {
      printJson({ ok: true, ...payload });
    } else {
      console.log(`Conversion preview: ${payload.ruleCount ?? 0} rule(s).`);
      for (const diagnostic of (payload as { diagnostics?: Array<{ severity: string; message: string }> }).diagnostics ?? []) {
        console.log(`  ${diagnostic.severity}: ${diagnostic.message}`);
      }
    }
    return;
  }

  reportSuccess(payload, format);
}
