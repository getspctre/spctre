import * as fs from "node:fs";
import * as path from "node:path";
import { readConfig, configPath, type SpctreCliConfig } from "./config";
import { refreshIfNeeded } from "./refresh";
import { readShadowLog, shadowLogSummary, isShadowModeActive } from "./shadow";
import { getOutputFormat, printJson, printProgress } from "./output";

type ConnectivityStatus = {
  ok: boolean;
  latencyMs?: number;
  serverHash?: string | null;
  fresh?: boolean | null;
  error?: string;
  plan?: string | null;
};

function describeTokenStatus(config: SpctreCliConfig): string {
  const now = Date.now();
  const accessExpiresAt = new Date(config.tokenExpiresAt).getTime();
  const refreshExpiresAt = config.refreshTokenExpiresAt
    ? new Date(config.refreshTokenExpiresAt).getTime()
    : null;
  const refreshDaysRemaining = refreshExpiresAt
    ? Math.floor((refreshExpiresAt - now) / (1000 * 60 * 60 * 24))
    : null;

  return accessExpiresAt - now <= 0
    ? "expired"
    : `valid · refreshes automatically · refresh expires in ${refreshDaysRemaining ?? "?"}d`;
}

function resolveLocalArtifactHash(config: SpctreCliConfig): {
  localHash: string;
  bundleExists: boolean;
} {
  const bundleAbsPath = path.resolve(process.cwd(), config.bundlePath);
  const bundleExists = fs.existsSync(bundleAbsPath);

  let localHash = config.artifactHash;
  if (bundleExists) {
    try {
      const bundle = JSON.parse(fs.readFileSync(bundleAbsPath, "utf8")) as {
        artifactHash?: string;
      };
      if (bundle.artifactHash) localHash = bundle.artifactHash;
    } catch {
      // use config hash as fallback
    }
  }
  return { localHash, bundleExists };
}

async function checkConnectivity(
  config: SpctreCliConfig,
  localHash: string,
  format: string,
): Promise<ConnectivityStatus> {
  if (format === "text") process.stderr.write("\nChecking connectivity...");
  try {
    const url = `${config.controlPlaneUrl.replace(/\/+$/, "")}/api/bundle/latest?workspace=${encodeURIComponent(config.workspaceId)}`;
    const start = Date.now();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - start;
    if (!res.ok) {
      if (format === "text") console.log(` ${res.status} ${res.statusText}`);
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    const serverHash = res.headers.get("x-spctre-artifact-hash") ?? null;
    const fresh = serverHash ? serverHash === localHash : null;
    const plan = res.headers.get("x-spctre-plan") ?? "oss";
    if (format === "text") {
      const freshLabel =
        fresh === null
          ? ""
          : fresh
            ? "  policy current"
            : `  policy outdated (server: ${serverHash?.slice(0, 19)})`;
      console.log(` ok (${latency}ms)${freshLabel}`);
    }
    return { ok: true, latencyMs: latency, serverHash, fresh, plan };
  } catch (err) {
    if (format === "text") console.log(` unreachable — ${String(err)}`);
    return { ok: false, error: String(err) };
  }
}

function printStatusJson(
  config: SpctreCliConfig,
  tokenLine: string,
  localHash: string,
  bundleExists: boolean,
  connectivityStatus: ConnectivityStatus | null,
) {
  const shadowActive = isShadowModeActive();
  const shadowEntries = readShadowLog();
  const shadow =
    shadowEntries.length > 0 || shadowActive
      ? { active: shadowActive, ...shadowLogSummary(shadowEntries) }
      : null;
  printJson({
    configPath: configPath(),
    workspaceId: config.workspaceId,
    workspaceSlug: config.workspaceSlug,
    agentId: config.agentId,
    environment: config.environment,
    tokenStatus: tokenLine,
    artifactHash: localHash,
    bundlePath: config.bundlePath,
    bundleExists,
    controlPlaneUrl: config.controlPlaneUrl,
    serviceAccountMode: config.serviceAccountMode ?? false,
    connectivity: connectivityStatus,
    shadow,
  });
}

function printShadowSection() {
  const shadowActive = isShadowModeActive();
  const shadowEntries = readShadowLog();
  if (shadowEntries.length === 0 && !shadowActive) return;
  const summary = shadowLogSummary(shadowEntries);
  const activeLabel = shadowActive ? "  [ACTIVE]" : "";
  console.log(`\nShadow mode${activeLabel}`);
  console.log(
    `  Decisions  ${summary.total} (${summary.allowed} allow, ${summary.denied} deny, ${summary.warned} warn)`,
  );
  if (summary.topBlockedRules.length > 0) {
    console.log(`  Top blocked  ${summary.topBlockedRules.join("  ")}`);
  }
}

function printOssRetentionWarning() {
  console.log("----------------------------------------------------------------");
  console.log("⚠️  DATA-LOSS RISK WARNING:");
  console.log("   Connected workspace is running on the OSS plan.");
  console.log("   Local evidence retention: 30 days (default)");
  console.log("   Cloud archival depth:     7 years (tamper-evident forensic ledger)");
  console.log("");
  console.log("   To bridge this gap and secure 7-year tamper-evident archival");
  console.log("   in Spctre Cloud, run the following command to start a free trial:");
  console.log("     spctre cloud login --trial");
  console.log("----------------------------------------------------------------");
  console.log("");
}

export async function status(options: { check: boolean; output?: string }) {
  let config = readConfig();

  if (!config) {
    console.error("No .spctre/config.json found. Run spctre init first.");
    process.exit(1);
  }

  // Refresh before doing anything so the token shown and used for --check is valid.
  config = await refreshIfNeeded(config);

  const tokenLine = describeTokenStatus(config);
  const { localHash, bundleExists } = resolveLocalArtifactHash(config);
  const format = getOutputFormat(options.output);

  const connectivityStatus = options.check
    ? await checkConnectivity(config, localHash, format)
    : null;

  if (format === "json") {
    printStatusJson(config, tokenLine, localHash, bundleExists, connectivityStatus);
    return;
  }

  printProgress("");
  console.log("Spctre CLI");
  console.log(`  Config       ${configPath()}`);
  console.log(`  Workspace    ${config.workspaceSlug} (${config.workspaceId})`);
  console.log(`  Agent        ${config.agentId}`);
  console.log(`  Environment  ${config.environment}`);
  console.log(`  Token        ${tokenLine}`);
  console.log(`  Policy       ${localHash}`);
  console.log(`  Bundle       ${config.bundlePath}${bundleExists ? "" : "  (not found on disk)"}`);
  console.log(`  Control plane  ${config.controlPlaneUrl}`);

  printShadowSection();

  const base = config.controlPlaneUrl.replace(/\/+$/, "");
  console.log("");
  console.log(`  Agents    ${base}/${config.workspaceSlug}/agents`);
  console.log(`  Evidence  ${base}/${config.workspaceSlug}/evidence`);
  console.log("");

  if (options.check && connectivityStatus?.ok && connectivityStatus.plan === "oss") {
    printOssRetentionWarning();
  }
}
