import type { SpctreCliConfig } from "./config";
import { isNonInteractive } from "./mode";
import {
  configFromCloudExchange,
  openBrowser,
  parseTimeoutMs,
  persistAndSyncCloudSession,
  pollDeviceToken,
  type CloudSessionExchange,
} from "./cloud-session";

interface InitOptions {
  url: string;
  workspace?: string;
  agent: string;
  environment: string;
  output: string;
  timeout: string;
  token?: string;
  device?: boolean;
  open: boolean;
}

type ExchangeResponse = CloudSessionExchange;

export async function init(options: InitOptions) {
  const baseUrl = options.url.replace(/\/+$/, "");
  const bundlePath = options.output;

  // Resolve token: explicit --token flag takes priority over SPCTRE_API_TOKEN env var.
  const resolvedToken = options.token ?? process.env.SPCTRE_API_TOKEN ?? null;

  if (resolvedToken) {
    await initWithServiceAccount({ ...options, baseUrl, bundlePath, resolvedToken });
    return;
  }

  if (options.device) {
    await initWithDeviceCode({ ...options, baseUrl, bundlePath });
    return;
  }

  if (isNonInteractive()) {
    console.error(
      "Error: spctre init requires a browser in interactive mode.\n" +
        "In CI, generate a service account key in the Spctre UI and run:\n" +
        "  spctre init --token <key> --workspace <slug>",
    );
    process.exit(1);
  }

  const timeoutMs = parseTimeoutMs(options.timeout);

  const startResponse = await fetch(`${baseUrl}/api/onboarding/cli/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      controlPlaneUrl: baseUrl,
      workspaceSlug: options.workspace,
      agentId: options.agent,
      environment: options.environment,
      bundlePath,
    }),
  });

  if (!startResponse.ok) {
    throw new Error(`Failed to start onboarding: ${await startResponse.text()}`);
  }

  const started = (await startResponse.json()) as {
    code: string;
    approveUrl: string;
    expiresAt: string;
  };

  console.log("Open this URL to approve the CLI:");
  console.log(started.approveUrl);
  if (options.open && !isNonInteractive()) {
    openBrowser(started.approveUrl);
    console.log("Opening browser...");
  }
  console.log("Waiting for browser approval...");

  const exchanged = await pollExchange(baseUrl, started.code, timeoutMs);
  const config = configFromCloudExchange({ baseUrl, bundlePath, exchange: exchanged });

  await persistAndSyncCloudSession(config, { refreshBundle: true, sampleSource: "spctre init" });

  console.log("");
  console.log("Spctre CLI connected.");
  console.log(`Workspace: ${config.workspaceSlug} (${config.workspaceId})`);
  console.log(`Agent: ${config.agentId}`);
  console.log(`Policy: ${config.artifactHash}`);
  console.log(`Bundle: ${config.bundlePath}`);
  console.log(`Agents: ${baseUrl}/${config.workspaceSlug}/agents`);
  console.log(`Evidence: ${baseUrl}/${config.workspaceSlug}/evidence`);
}

async function pollExchange(
  baseUrl: string,
  code: string,
  timeoutMs: number,
): Promise<ExchangeResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}/api/onboarding/cli/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (response.status === 200) return (await response.json()) as ExchangeResponse;
    if (response.status !== 202) {
      throw new Error(`CLI approval failed: ${await response.text()}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for browser approval.");
}

interface ServiceAccountExchangeResponse {
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

async function initWithServiceAccount(
  options: InitOptions & { baseUrl: string; bundlePath: string; resolvedToken: string },
) {
  const workspaceSlug = options.workspace;
  if (!workspaceSlug || workspaceSlug === "default") {
    console.error(
      "Error: --workspace <slug> is required when using --token.\n" +
        "Example: spctre init --token spctre_svc_... --workspace my-workspace",
    );
    process.exit(1);
  }

  const exchangeResponse = await fetch(`${options.baseUrl}/api/onboarding/cli/service-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.resolvedToken}`,
    },
    body: JSON.stringify({
      workspaceSlug,
      agentId: options.agent,
      environment: options.environment,
      bundlePath: options.bundlePath,
    }),
  });

  if (!exchangeResponse.ok) {
    const body = await exchangeResponse.text().catch(() => "");
    console.error(`Error: Service account exchange failed (${exchangeResponse.status}): ${body}`);
    process.exit(1);
  }

  const exchanged = (await exchangeResponse.json()) as ServiceAccountExchangeResponse;

  const config = configFromCloudExchange({
    baseUrl: options.baseUrl,
    exchange: {
      ...exchanged,
      token: options.resolvedToken,
      tokenId: "",
      tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    },
    serviceAccountMode: true,
    token: options.resolvedToken,
  });

  await persistAndSyncCloudSession(config, { heartbeat: false });

  console.log("Spctre CLI connected (service account mode).");
  console.log(`Workspace: ${config.workspaceSlug} (${config.workspaceId})`);
  console.log(`Agent: ${config.agentId}`);
  console.log(`Policy: ${config.artifactHash}`);
  console.log(`Bundle: ${config.bundlePath}`);
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

async function initWithDeviceCode(options: InitOptions & { baseUrl: string; bundlePath: string }) {
  const startResponse = await fetch(`${options.baseUrl}/api/onboarding/device/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      controlPlaneUrl: options.baseUrl,
      workspaceSlug: options.workspace,
      agentId: options.agent,
      environment: options.environment,
      bundlePath: options.bundlePath,
    }),
  });

  if (!startResponse.ok) {
    console.error(`Error: Failed to start device flow: ${await startResponse.text()}`);
    process.exit(1);
  }

  const started = (await startResponse.json()) as DeviceStartResponse;

  process.stderr.write(`\nTo approve this CLI, open:\n  ${started.verificationUri}\n\n`);
  process.stderr.write(`And enter the code:\n  ${started.userCode}\n\n`);
  if (options.open && !isNonInteractive()) {
    openBrowser(started.verificationUriComplete);
    process.stderr.write("Opening browser...\n");
  }
  process.stderr.write("Waiting for device approval...\n");

  const timeoutMs = parseTimeoutMs(options.timeout);

  const exchanged = await pollDeviceToken(
    options.baseUrl,
    started.deviceCode,
    started.interval,
    timeoutMs,
  );

  const config = configFromCloudExchange({ baseUrl: options.baseUrl, exchange: exchanged });

  await persistAndSyncCloudSession(config, { refreshBundle: true });

  console.log("");
  console.log("Spctre CLI connected.");
  console.log(`Workspace: ${config.workspaceSlug} (${config.workspaceId})`);
  console.log(`Agent: ${config.agentId}`);
  console.log(`Policy: ${config.artifactHash}`);
  console.log(`Bundle: ${config.bundlePath}`);
  console.log(`Agents: ${options.baseUrl}/${config.workspaceSlug}/agents`);
  console.log(`Evidence: ${options.baseUrl}/${config.workspaceSlug}/evidence`);
}
