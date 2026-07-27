import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { ingest } from "./ingest";
import { sync } from "./sync";
import { writeConfig, type SpctreCliConfig } from "./config";

export interface CloudSessionExchange {
  token: string;
  tokenId: string;
  tokenExpiresAt: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  tenantId: string;
  workspaceId: string;
  workspaceSlug: string;
  agentId: string;
  environment: string;
  bundlePath: string;
  artifactHash: string;
  branchId: string;
  revisionId: string;
  policyContext: SpctreCliConfig["policyContext"];
}

export function openBrowser(url: string) {
  // argv form (no shell) so a hostile URL can't inject shell metacharacters.
  const [file, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  execFile(file as string, args as string[], () => {});
}

export function parseTimeoutMs(timeout: string, fallbackMs = 60_000): number {
  const timeoutSeconds = Number.parseInt(timeout, 10);
  return Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : fallbackMs;
}

export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
  intervalSeconds: number,
  timeoutMs: number
): Promise<CloudSessionExchange> {
  const startedAt = Date.now();
  let currentInterval = intervalSeconds * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, currentInterval));

    const response = await fetch(`${baseUrl}/api/onboarding/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });

    if (response.status === 200) return (await response.json()) as CloudSessionExchange;
    if (response.status === 429) {
      currentInterval = Math.min(currentInterval * 2, 30_000);
      continue;
    }
    if (response.status === 428) continue;
    throw new Error(`Device token exchange failed (${response.status}): ${await response.text()}`);
  }

  throw new Error("Timed out waiting for device approval.");
}

export function configFromCloudExchange(params: {
  baseUrl: string;
  bundlePath?: string;
  exchange: CloudSessionExchange;
  token?: string;
  serviceAccountMode?: boolean;
}): SpctreCliConfig {
  const token = params.token ?? params.exchange.token;
  const config: SpctreCliConfig = {
    controlPlaneUrl: params.baseUrl,
    tenantId: params.exchange.tenantId,
    workspaceId: params.exchange.workspaceId,
    workspaceSlug: params.exchange.workspaceSlug,
    agentId: params.exchange.agentId,
    environment: params.exchange.environment,
    token,
    tokenId: params.exchange.tokenId,
    tokenExpiresAt: params.exchange.tokenExpiresAt,
    artifactHash: params.exchange.artifactHash,
    branchId: params.exchange.branchId,
    revisionId: params.exchange.revisionId,
    bundlePath: params.bundlePath ?? params.exchange.bundlePath,
    policyContext: params.exchange.policyContext,
  };

  if (params.exchange.refreshToken) config.refreshToken = params.exchange.refreshToken;
  if (params.exchange.refreshTokenExpiresAt) config.refreshTokenExpiresAt = params.exchange.refreshTokenExpiresAt;
  if (params.serviceAccountMode) config.serviceAccountMode = true;

  return config;
}

export async function persistAndSyncCloudSession(
  config: SpctreCliConfig,
  options: { heartbeat?: boolean; refreshBundle?: boolean; sampleSource?: string } = {}
) {
  writeConfig(config);

  await sync({
    workspace: config.workspaceId,
    key: config.token,
    output: config.bundlePath,
    url: config.controlPlaneUrl,
    quiet: true,
  });

  if (options.refreshBundle) {
    refreshConfigFromBundle(config);
    writeConfig(config);
  }

  if (options.heartbeat ?? true) {
    await ingest({
      agent: config.agentId,
      workspace: config.workspaceId,
      key: config.token,
      hash: config.artifactHash,
      heartbeat: true,
      url: config.controlPlaneUrl,
      environment: config.environment,
      policyContext: config.policyContext,
      quiet: true,
    });
  }

  if (options.sampleSource) {
    await ingest({
      key: config.token,
      url: config.controlPlaneUrl,
      payload: JSON.stringify({
        decisionId: `sample-${Date.now()}`,
        tenantId: config.tenantId,
        workspaceId: config.workspaceId,
        environment: config.environment,
        runtimeTarget: { stack: "LOCAL", adapter: "spctre-cli" },
        agentId: config.agentId,
        connector: "sample",
        action: "event.register",
        status: "ALLOW",
        reason: "Sample onboarding event registered.",
        policyRefs: ["sample.event.allow"],
        artifactHash: config.artifactHash,
        policyContext: config.policyContext,
        latencyMs: 1,
        createdAt: new Date().toISOString(),
        rawEvidence: { source: options.sampleSource },
      }),
      quiet: true,
    });
  }
}

function refreshConfigFromBundle(config: SpctreCliConfig) {
  const bundleFile = path.resolve(process.cwd(), config.bundlePath);
  if (!fs.existsSync(bundleFile)) return;

  try {
    const bundle = JSON.parse(fs.readFileSync(bundleFile, "utf8")) as {
      artifactHash?: string;
      branchId?: string;
      revisionId?: string;
    };
    if (bundle.artifactHash) config.artifactHash = bundle.artifactHash;
    if (bundle.branchId) config.branchId = bundle.branchId;
    if (bundle.revisionId) config.revisionId = bundle.revisionId;
    config.policyContext = [
      {
        scope: "WORKSPACE",
        branchId: config.branchId,
        revisionId: config.revisionId,
        artifactHash: config.artifactHash,
      },
    ];
  } catch {
    // Keep exchange metadata if parsing fails.
  }
}
