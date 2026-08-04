import type { SpctreClient, HeartbeatRecord } from "./client.js";
import type { HeartbeatPayload } from "./types.js";

export async function emitHeartbeatEvidence(
  client: SpctreClient,
  payload: HeartbeatPayload,
  workspaceId: string,
  tenantId: string,
  environment?: string,
): Promise<void> {
  const record: HeartbeatRecord = {
    type: "HEARTBEAT",
    agentId: payload.agentId,
    workspaceId,
    tenantId,
    runtimeTarget: { stack: "PAPERCLIP", adapter: "@spctre/paperclip", environment },
    companyId: payload.companyId,
    issueId: payload.issueId,
    goalId: payload.goalId,
    runStatus: payload.runStatus,
    taskContext: payload.taskContext,
    emittedAt: payload.timestamp ?? new Date().toISOString(),
  };
  await client.emitHeartbeat(record);
}
