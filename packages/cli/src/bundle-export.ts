import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyPolicyBundleExport } from "@spctre/policy-schema";
import type { PolicyBundleExportManifest } from "@spctre/policy-schema";
import { readConfig, requireConfig } from "./config";
import { refreshIfNeeded } from "./refresh";

const EXPORT_FORMATS = new Set([
  "spctre-json",
  "opa-rego",
  "opa-bundle",
  "cedar",
  "mcp-proxy-config",
]);

type BundleExportEnvelope = {
  artifact?: string | Record<string, unknown>;
  manifest?: Record<string, unknown>;
  error?: string;
};

type BundleExportPreview = { formats?: PolicyBundleExportManifest[]; error?: string };

type CliAuthOptions = { workspace?: string; key?: string; url?: string };

async function resolveCliAuth(
  options: CliAuthOptions,
): Promise<{ workspace: string; key: string; url: string }> {
  let resolved =
    !options.workspace || !options.key || !options.url ? requireConfig() : readConfig();
  if (resolved) resolved = await refreshIfNeeded(resolved);

  const workspace = options.workspace ?? resolved?.workspaceId;
  const key = options.key ?? resolved?.token;
  const url = (options.url ?? resolved?.controlPlaneUrl ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  if (!workspace || !key) {
    console.error(
      "Error: workspace and key are required. Run spctre init first or pass --workspace and --key.",
    );
    process.exit(1);
  }

  return { workspace, key, url };
}

export async function bundlePreview(options: {
  workspace?: string;
  key?: string;
  url?: string;
  output?: string;
  strict?: boolean;
}): Promise<{ format: string; ok: boolean; blockingWarnings: string[] }[] | undefined> {
  const { workspace, key, url } = await resolveCliAuth(options);
  const targetUrl = `${url}/api/v1/bundle/latest?workspace=${encodeURIComponent(workspace)}&preview=true`;

  try {
    const response = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const body = (await response.json()) as BundleExportPreview;
    if (!response.ok || !Array.isArray(body.formats)) {
      throw new Error(body.error ?? response.statusText);
    }
    const rows = body.formats.map((manifest) => ({
      format: manifest.format,
      ok: manifest.blockingWarnings.length === 0,
      blockingWarnings: manifest.blockingWarnings,
    }));

    if (options.output === "json") {
      console.log(JSON.stringify({ formats: rows }, null, 2));
    } else {
      console.log("Bundle export targets:");
      for (const row of rows) {
        console.log(`  ${row.format}: ${row.ok ? "READY" : "BLOCKED"}`);
        for (const warning of row.blockingWarnings) console.log(`    - ${warning}`);
      }
    }

    if (options.strict && rows.some((row) => !row.ok)) process.exit(1);
    return rows;
  } catch (error) {
    console.error(`Bundle preview failed: ${String(error)}`);
    process.exit(1);
  }
}

export async function bundleExport(options: {
  format: string;
  workspace?: string;
  key?: string;
  output?: string;
  manifestOutput?: string;
  url?: string;
  quiet?: boolean;
}): Promise<{ outputPath: string; manifestPath: string; verified: boolean } | undefined> {
  if (!EXPORT_FORMATS.has(options.format)) {
    console.error(`Error: unsupported bundle export format "${options.format}".`);
    console.error(`Supported formats: ${Array.from(EXPORT_FORMATS).join(", ")}`);
    process.exit(1);
  }

  const { workspace, key, url } = await resolveCliAuth(options);

  const targetUrl = `${url}/api/v1/bundle/latest?workspace=${encodeURIComponent(workspace)}&format=${encodeURIComponent(options.format)}`;

  try {
    const response = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const body = (await response.json()) as BundleExportEnvelope;
    if (!response.ok) {
      const blocker = Array.isArray(body.manifest?.blockingWarnings)
        ? ` ${body.manifest.blockingWarnings.join("; ")}`
        : "";
      throw new Error(`${body.error ?? response.statusText}${blocker}`);
    }
    if (!body.manifest || body.artifact === undefined) {
      throw new Error("Bundle export response did not include artifact and manifest.");
    }

    const outputPath = path.resolve(
      process.cwd(),
      options.output ?? defaultArtifactPath(options.format),
    );
    const manifestPath = path.resolve(
      process.cwd(),
      options.manifestOutput ?? `${outputPath}.manifest.json`,
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(outputPath, serializeArtifact(body.artifact));
    fs.writeFileSync(manifestPath, `${JSON.stringify(body.manifest, null, 2)}\n`);

    const verified = response.headers.get("x-spctre-export-verified") === "true";
    if (!options.quiet) {
      console.log(`Exported ${options.format} artifact to ${outputPath}`);
      console.log(`Manifest written to ${manifestPath}`);
      console.log(`Verified: ${verified ? "yes" : "no"}`);
    }
    return { outputPath, manifestPath, verified };
  } catch (error) {
    console.error(`Bundle export failed: ${String(error)}`);
    process.exit(1);
  }
}

export async function bundleVerify(options: {
  artifact: string;
  manifest: string;
  output?: string;
}): Promise<{ ok: boolean; issues: string[] } | undefined> {
  try {
    const artifactPath = path.resolve(process.cwd(), options.artifact);
    const manifestPath = path.resolve(process.cwd(), options.manifest);
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as PolicyBundleExportManifest;
    const artifact = readArtifactForManifest(artifactPath, manifest);
    const verification = verifyPolicyBundleExport({ artifact, manifest });

    if (options.output === "json") {
      console.log(
        JSON.stringify(
          { ...verification, verificationTargets: manifest.verificationTargets },
          null,
          2,
        ),
      );
    } else {
      console.log(`Bundle export verification: ${verification.ok ? "PASS" : "FAIL"}`);
      console.log(`Expected: ${verification.expectedHash}`);
      console.log(`Actual:   ${verification.actualHash ?? "missing"}`);
      if (verification.issues.length > 0) {
        console.log("Issues:");
        for (const issue of verification.issues) console.log(`  - ${issue}`);
      }
      if (manifest.verificationTargets.length > 0) {
        console.log("External verifier targets:");
        for (const target of manifest.verificationTargets) console.log(`  - ${target}`);
      }
    }

    if (!verification.ok) process.exit(1);
    return { ok: verification.ok, issues: verification.issues };
  } catch (error) {
    console.error(`Bundle verification failed: ${String(error)}`);
    process.exit(1);
  }
}

export interface VerifierRunResult {
  tool: string;
  status: "pass" | "fail" | "skipped" | "informational";
  reason?: string;
}

type VerifierInvocation =
  | { type: "run"; exe: string; args: (artifact: string, manifest: string) => string[] }
  | { type: "informational"; note: string };

type VerifierSpec = { label: string } & VerifierInvocation;

// Format-aware dispatch: each entry knows the exact exe + arg shape for that tool.
// verificationTargets in the manifest are display strings for operators; this table
// is the authoritative invocation spec. Labels not present here are informational.
const FORMAT_VERIFIER_DISPATCH: Partial<Record<string, VerifierSpec[]>> = {
  "spctre-json": [
    {
      label: "spctre bundle verify",
      type: "run",
      exe: "spctre",
      args: (artifact, manifest) => [
        "bundle",
        "verify",
        "--artifact",
        artifact,
        "--manifest",
        manifest,
      ],
    },
    {
      label: "agt verify --evidence",
      type: "informational",
      note: "AGT verify runs inside the AGT runtime workflow, not as a standalone CLI gate.",
    },
  ],
  "opa-rego": [
    { label: "opa check", type: "run", exe: "opa", args: (artifact) => ["check", artifact] },
    { label: "opa test", type: "run", exe: "opa", args: (artifact) => ["test", artifact] },
  ],
  "opa-bundle": [
    { label: "opa build", type: "run", exe: "opa", args: (artifact) => ["build", artifact] },
    { label: "opa check", type: "run", exe: "opa", args: (artifact) => ["check", artifact] },
  ],
  cedar: [
    {
      label: "cedar validate",
      type: "run",
      exe: "cedar",
      args: (artifact) => ["validate", "--policies", artifact],
    },
    {
      label: "cedar authorize",
      type: "informational",
      note: "cedar authorize requires a request JSON; run it manually with your entity/context data.",
    },
  ],
  "mcp-proxy-config": [
    {
      label: "spctre mcp config validate",
      type: "informational",
      note: "No formal MCP proxy config validator is available yet.",
    },
  ],
};

function runVerifierSpec(
  spec: VerifierSpec,
  artifactPath: string,
  manifestPath: string,
): VerifierRunResult {
  if (spec.type === "informational") {
    return { tool: spec.label, status: "informational", reason: spec.note };
  }
  const args = spec.args(artifactPath, manifestPath);
  try {
    const r = spawnSync(spec.exe, args, { encoding: "utf8", timeout: 30000 });
    if (r.error) {
      const errCode = (r.error as NodeJS.ErrnoException).code;
      if (errCode === "ENOENT") {
        return { tool: spec.label, status: "skipped", reason: `${spec.exe} not found in PATH` };
      }
      return { tool: spec.label, status: "fail", reason: r.error.message };
    }
    if (r.status === 0) return { tool: spec.label, status: "pass" };
    const reason = r.stderr?.trim() || r.stdout?.trim() || "non-zero exit";
    return { tool: spec.label, status: "fail", reason };
  } catch {
    return { tool: spec.label, status: "skipped", reason: `${spec.exe} not found in PATH` };
  }
}

export async function bundleRunVerifiers(options: {
  artifact: string;
  manifest: string;
  output?: string;
  allowMissingTools?: boolean;
}): Promise<{ ok: boolean; results: VerifierRunResult[] } | undefined> {
  try {
    const artifactPath = path.resolve(process.cwd(), options.artifact);
    const manifestPath = path.resolve(process.cwd(), options.manifest);
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as PolicyBundleExportManifest;

    const formatMapped = Object.prototype.hasOwnProperty.call(
      FORMAT_VERIFIER_DISPATCH,
      manifest.format,
    );
    const specs = FORMAT_VERIFIER_DISPATCH[manifest.format] ?? [];
    const results: VerifierRunResult[] = specs.map((spec) =>
      runVerifierSpec(spec, artifactPath, manifestPath),
    );

    const informationalCount = results.filter((r) => r.status === "informational").length;
    const skippedCount = results.filter((r) => r.status === "skipped").length;
    const failCount = results.filter((r) => r.status === "fail").length;
    const passCount = results.filter((r) => r.status === "pass").length;
    const runnableCount = results.length - informationalCount;
    const allRunnableSkipped = runnableCount > 0 && skippedCount === runnableCount;

    // Distinct executables that could have run for this format — used to give an
    // accurate install hint instead of hard-coding a fixed tool list.
    const requiredTools = Array.from(
      new Set(
        specs
          .filter((s) => s.type === "run")
          .map((s) => (s as Extract<VerifierSpec, { type: "run" }>).exe),
      ),
    );

    const ok =
      failCount === 0 &&
      !allRunnableSkipped &&
      formatMapped &&
      (options.allowMissingTools || skippedCount === 0);

    // Fail closed: no verifier is configured for this format, so nothing was
    // actually checked. Reporting success here would let an unverified bundle
    // pass a CI gate keyed on the exit code.
    if (!formatMapped) {
      console.error(
        `No verifiers are configured for format "${manifest.format}"; nothing was checked.`,
      );
    }

    if (options.output === "json") {
      console.log(
        JSON.stringify(
          {
            ok,
            passed: passCount,
            failed: failCount,
            skipped: skippedCount,
            informational: informationalCount,
            results,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`Bundle verifier results: ${ok ? "PASS" : "FAIL"}`);
      for (const r of results) {
        const suffix = r.reason ? ` (${r.reason})` : "";
        console.log(`  ${r.tool}: ${r.status.toUpperCase()}${suffix}`);
      }
      if (allRunnableSkipped) {
        const install =
          requiredTools.length > 0 ? requiredTools.join(" or ") : "the required verifier tools";
        console.error(
          `No verifier tools were found. Install ${install}, or pass --allow-missing-tools.`,
        );
      }
    }

    if (!ok) process.exit(1);
    return { ok, results };
  } catch (error) {
    console.error(`Bundle run-verifiers failed: ${String(error)}`);
    process.exit(1);
  }
}

function defaultArtifactPath(format: string): string {
  switch (format) {
    case "opa-rego":
      return "spctre-policy.rego";
    case "cedar":
      return "spctre-policy.cedar";
    case "opa-bundle":
      return "spctre-opa-bundle.json";
    case "mcp-proxy-config":
      return "spctre-mcp-proxy.json";
    default:
      return "spctre-policy-export.json";
  }
}

function serializeArtifact(artifact: string | Record<string, unknown>): string {
  return typeof artifact === "string"
    ? `${artifact.replace(/\s+$/, "")}\n`
    : `${JSON.stringify(artifact, null, 2)}\n`;
}

function readArtifactForManifest(
  artifactPath: string,
  manifest: PolicyBundleExportManifest,
): string | Record<string, unknown> {
  const raw = fs.readFileSync(artifactPath, "utf8");
  if (
    manifest.format === "spctre-json" ||
    manifest.format === "opa-bundle" ||
    manifest.format === "mcp-proxy-config"
  ) {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  return raw;
}
