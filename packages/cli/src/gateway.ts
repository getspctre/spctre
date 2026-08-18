import type { SpctreCliConfig } from "./config";

export interface CredentialGrant {
  credentialType: string;
  injectedParameter: string;
  credentialValue: string;
  expiresAt: string;
}

export interface GatewayDecisionResponse {
  gatewayEnabled: boolean;
  mode: string;
  persisted: boolean;
  queued: boolean;
  decision: {
    outcome: "PROCEED" | "ESCALATE" | "ABORT";
    reason: string;
    riskLevel: string;
    shouldQueue: boolean;
    slaHours?: number;
    credentialGrant?: CredentialGrant;
  };
}

export interface EscalationStatusResponse {
  decisionId: string;
  status: "PENDING" | "IN_REVIEW" | "RESOLVED" | "EXPIRED";
  resolutionOutcome?: "PROCEED" | "ESCALATE" | "ABORT";
  resolutionNote?: string;
  agentGuidance?: string;
  slaDueAt?: string;
  resolvedAt?: string;
  credentialGrant?: CredentialGrant;
}

export interface GatewayConfig {
  gatewayUrl: string;
  token: string;
  timeoutMs: number;
  pollIntervalMs: number;
  outagePolicy: "fail-open" | "fail-closed";
}

export function resolveGatewayConfig(
  config: SpctreCliConfig,
  mode: "observe" | "enforce",
): GatewayConfig | null {
  const gatewayUrl = config.gatewayUrl || process.env.SPCTRE_GATEWAY_URL;
  if (!gatewayUrl) return null;

  const timeoutMs = Math.max(
    5000,
    (Number.parseInt(process.env.SPCTRE_GATEWAY_TIMEOUT ?? "1800", 10) || 1800) * 1000,
  );
  const pollIntervalMs = Math.max(
    2000,
    (Number.parseInt(process.env.SPCTRE_GATEWAY_POLL_INTERVAL ?? "10", 10) || 10) * 1000,
  );

  let outagePolicy: "fail-open" | "fail-closed" = mode === "enforce" ? "fail-closed" : "fail-open";
  const envPolicy = process.env.SPCTRE_GATEWAY_OUTAGE_POLICY;
  if (envPolicy === "fail-open" || envPolicy === "fail-closed") {
    outagePolicy = envPolicy;
  } else if (
    config.gatewayOutagePolicy === "fail-open" ||
    config.gatewayOutagePolicy === "fail-closed"
  ) {
    outagePolicy = config.gatewayOutagePolicy;
  }

  return {
    gatewayUrl: gatewayUrl.replace(/\/+$/, ""),
    token: config.token,
    timeoutMs,
    pollIntervalMs,
    outagePolicy,
  };
}

export async function requestGatewayDecision(
  gwConfig: GatewayConfig,
  config: SpctreCliConfig,
  params: {
    decisionId: string;
    connector?: string;
    action?: string;
    consequence?: string;
    toolIntent?: string;
    planSummary?: string;
    toolParameters?: Record<string, unknown>;
  },
): Promise<GatewayDecisionResponse | null> {
  const url = `${gwConfig.gatewayUrl}/api/v1/gateway/decide`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gwConfig.token}` },
      body: JSON.stringify({
        decisionId: params.decisionId,
        artifactHash: config.artifactHash,
        policyContext: config.policyContext,
        agentId: config.agentId,
        connector: params.connector,
        action: params.action,
        consequence: params.consequence,
        toolIntent: params.toolIntent,
        planSummary: params.planSummary,
        toolParameters: params.toolParameters,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as GatewayDecisionResponse;
  } catch {
    return null;
  }
}

export async function pollEscalationResolution(
  gwConfig: GatewayConfig,
  decisionId: string,
): Promise<EscalationStatusResponse> {
  const startTime = Date.now();
  const url = `${gwConfig.gatewayUrl}/api/v1/gateway/escalations/status?decisionId=${encodeURIComponent(decisionId)}`;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = gwConfig.timeoutMs - elapsed;
    if (remainingMs <= 0) {
      return { decisionId, status: "EXPIRED" };
    }

    // Bound each attempt to a single poll interval rather than to the whole
    // remaining window. A connection that stalls without erroring must not
    // consume the entire escalation budget: that would poll once and then
    // report EXPIRED, so a reviewer who approves in the meantime is never
    // observed. An aborted request rejects into the catch below and the loop
    // retries on its normal cadence.
    const attemptMs = Math.min(remainingMs, gwConfig.pollIntervalMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${gwConfig.token}` },
        signal: AbortSignal.timeout(attemptMs),
      });

      if (response.ok) {
        const data = (await response.json()) as EscalationStatusResponse;
        if (data.status === "RESOLVED" || data.status === "EXPIRED") {
          return data;
        }
      }
    } catch {
      // Ignored: retry until timeout
    }

    process.stderr.write(".");
    const sleepMs = Math.min(
      gwConfig.pollIntervalMs,
      Math.max(0, gwConfig.timeoutMs - (Date.now() - startTime)),
    );
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}
