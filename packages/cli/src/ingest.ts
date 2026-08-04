import type { AgtRuntimeDecisionInput } from "@spctre/policy-schema";
import type { RuntimePolicyContext } from "@spctre/policy-schema";
import { readConfig, requireConfig } from "./config";
import { refreshIfNeeded } from "./refresh";
import { getOutputFormat, printJson } from "./output";

interface IngestOptions {
  agent?: string;
  workspace?: string;
  key?: string;
  hash?: string;
  heartbeat?: boolean;
  payload?: string;
  url?: string;
  environment?: string;
  policyContext?: RuntimePolicyContext[];
  quiet?: boolean;
  output?: string;
}

async function resolveIngestSettings(
  options: IngestOptions,
): Promise<{ key: string; url: string; resolved: ReturnType<typeof readConfig> }> {
  const config = readConfig();
  const needsConfig =
    !options.key ||
    !options.url ||
    (options.heartbeat && (!options.agent || !options.workspace || !options.hash));
  let resolved = needsConfig ? requireConfig() : config;
  if (resolved && !options.key) resolved = await refreshIfNeeded(resolved);
  const key = options.key ?? resolved?.token;
  const url = (options.url ?? resolved?.controlPlaneUrl ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  if (!key) {
    console.error("Error: --key is required. Run spctre init first or pass --key.");
    process.exit(1);
  }

  return { key, url, resolved };
}

export async function ingest(options: IngestOptions) {
  const format = getOutputFormat(options.output);
  const { key, url, resolved } = await resolveIngestSettings(options);
  const evidence: AgtRuntimeDecisionInput = parseEvidence(options, resolved ?? undefined);

  try {
    const response = await fetch(`${url}/api/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(evidence),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorBody || response.statusText}`);
    }

    if (!options.quiet) {
      if (format === "json") {
        printJson({ ok: true, connector: evidence.connector, action: evidence.action });
      } else {
        console.log("Evidence ingested successfully.");
      }
    }
    return { evidence };
  } catch (error) {
    if (format === "json") {
      printJson({ ok: false, error: String(error) });
      process.exit(1);
    }
    console.error(`Ingestion failed: ${String(error)}`);
    process.exit(1);
  }
}

function buildHeartbeatEvidence(params: {
  agentId: string;
  workspaceId: string;
  artifactHash: string;
  tenantId: string;
  environment: string;
  policyContext: RuntimePolicyContext[];
}): AgtRuntimeDecisionInput {
  if (!params.policyContext.length) {
    console.error(
      "Error: heartbeat requires policy context. Run spctre init or pass a payload with policyContext.",
    );
    process.exit(1);
  }

  return {
    decisionId: `hb-${Date.now()}`,
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    environment: params.environment,
    runtimeTarget: { stack: "LOCAL", adapter: "spctre-cli" },
    agentId: params.agentId,
    connector: "system",
    action: "heartbeat",
    status: "ALLOW",
    reason: "Standard boot-up heartbeat.",
    policyRefs: ["system.heartbeat"],
    artifactHash: params.artifactHash,
    policyContext: params.policyContext,
    latencyMs: 0,
    createdAt: new Date().toISOString(),
    rawEvidence: { source: "spctre cli heartbeat" },
  };
}

type ParseEvidenceConfig = {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  artifactHash: string;
  environment: string;
  policyContext: RuntimePolicyContext[];
};

function parseHeartbeatEvidence(
  options: IngestOptions,
  config?: ParseEvidenceConfig,
): AgtRuntimeDecisionInput {
  const agent = options.agent ?? config?.agentId;
  const workspace = options.workspace ?? config?.workspaceId;
  const hash = options.hash ?? config?.artifactHash;
  const tenantId = config?.tenantId ?? "tenant-demo";
  const environment = options.environment ?? config?.environment ?? "production";
  const policyContext = options.policyContext ?? config?.policyContext ?? [];

  if (!agent || !workspace || !hash) {
    console.error("Error: --agent, --workspace, and --hash are required for heartbeat.");
    process.exit(1);
  }

  return buildHeartbeatEvidence({
    agentId: agent,
    workspaceId: workspace,
    artifactHash: hash,
    tenantId,
    environment,
    policyContext,
  });
}

function parseEvidence(
  options: IngestOptions,
  config?: ParseEvidenceConfig,
): AgtRuntimeDecisionInput {
  if (options.heartbeat) {
    return parseHeartbeatEvidence(options, config);
  }

  if (options.payload) {
    try {
      return JSON.parse(options.payload) as AgtRuntimeDecisionInput;
    } catch {
      console.error("Error: Payload must be valid JSON.");
      process.exit(1);
    }
  }

  console.error("Error: Either --heartbeat or --payload must be provided.");
  process.exit(1);
}
