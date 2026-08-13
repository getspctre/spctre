import { isNonInteractive } from "./mode";
import {
  configFromCloudExchange,
  openBrowser,
  parseTimeoutMs,
  persistAndSyncCloudSession,
  pollDeviceToken,
} from "./cloud-session";

interface CloudLoginOptions {
  url: string;
  workspace?: string;
  agent: string;
  environment: string;
  output: string;
  timeout: string;
  trial: boolean;
  open: boolean;
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export async function cloudLogin(options: CloudLoginOptions) {
  const baseUrl = options.url.replace(/\/+$/, "");
  const bundlePath = options.output;

  if (isNonInteractive()) {
    console.error(
      "Error: spctre cloud login requires interactive mode for browser/device authorization.",
    );
    process.exit(1);
  }

  const startResponse = await fetch(`${baseUrl}/api/onboarding/device/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      controlPlaneUrl: baseUrl,
      workspaceSlug: options.workspace,
      agentId: options.agent,
      environment: options.environment,
      bundlePath,
      trial: options.trial,
    }),
  });

  if (!startResponse.ok) {
    console.error(`Error: Failed to start device flow: ${await startResponse.text()}`);
    process.exit(1);
  }

  const started = (await startResponse.json()) as DeviceStartResponse;

  console.log("");
  if (options.trial) {
    // No capacities or windows here. The trial's numbers come from the
    // deployment's entitlement catalog, which this client cannot read, so
    // anything stated here is a copy that drifts — the retention line used to
    // say 7 days against a catalog granting 90. The approval page can read the
    // catalog; it states the terms.
    console.log("----------------------------------------------------------------");
    console.log("              ACTIVATE SPCTRE CLOUD HOSTED TRIAL                ");
    console.log("----------------------------------------------------------------");
    console.log("   • No credit card required                                    ");
    console.log("   • Terms are shown on the approval page before you accept     ");
    console.log("----------------------------------------------------------------");
  } else {
    console.log("Connecting to Spctre Cloud...");
  }
  console.log("");
  console.log(`To approve this CLI agent, open:`);
  console.log(`  ${started.verificationUri}`);
  console.log("");
  console.log(`And enter the following activation code:`);
  console.log(`  ${started.userCode}`);
  console.log("");

  if (options.open) {
    openBrowser(started.verificationUriComplete);
    console.log("Opening browser approval page...");
  }

  console.log("Waiting for device approval...");

  const timeoutMs = parseTimeoutMs(options.timeout);

  const exchanged = await pollDeviceToken(baseUrl, started.deviceCode, started.interval, timeoutMs);

  const config = configFromCloudExchange({ baseUrl, bundlePath, exchange: exchanged });

  await persistAndSyncCloudSession(config, {
    refreshBundle: true,
    sampleSource: "spctre cloud login",
  });

  console.log("");
  console.log("Spctre CLI connected successfully.");
  console.log(`Workspace: ${config.workspaceSlug} (${config.workspaceId})`);
  console.log(`Agent:     ${config.agentId}`);
  console.log(`Policy:    ${config.artifactHash}`);
  console.log(`Bundle:    ${config.bundlePath}`);
}
