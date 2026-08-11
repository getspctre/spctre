import { isRecord } from "@/lib/records";

export type ManagedProvider = "bedrock_agentcore" | "docker_ai_governance" | "langsmith";

export function normalizeManagedProviderEvent(
  provider: ManagedProvider,
  raw: Record<string, unknown>,
) {
  switch (provider) {
    case "bedrock_agentcore":
      return {
        ...raw,
        provider,
        agent: { id: raw["aws.agent.id"] ?? raw.agent_id ?? raw.agentId },
        occurred_at: raw.event_timestamp ?? raw.timestamp ?? raw.time,
        action: raw["aws.operation.name"] ?? raw.operation ?? "agentcore.observe",
        source_event_id: raw["aws.request_id"] ?? raw.request_id,
      };
    case "docker_ai_governance":
      return {
        ...raw,
        provider,
        agent: { id: raw.agent_id ?? raw.agentId },
        occurred_at: raw.timestamp ?? raw.occurred_at,
        action: raw.action ?? raw.event_type ?? "docker.governance.observe",
        source_event_id: raw.event_id ?? raw.id,
      };
    case "langsmith": {
      const inputs = isRecord(raw.inputs) ? raw.inputs : {};
      return {
        ...raw,
        provider,
        agent: { id: raw.session_id ?? raw.run_id ?? raw.id },
        occurred_at: raw.start_time ?? raw.timestamp,
        action: raw.name ?? raw.run_type ?? "langsmith.trace",
        source_event_id: raw.id ?? raw.run_id,
        inputs,
      };
    }
  }
}
