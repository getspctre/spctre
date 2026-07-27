import type { PaperclipEvidenceRecord } from "./types.js";

export interface HeartbeatRecord {
  type: "HEARTBEAT";
  agentId: string;
  workspaceId: string;
  tenantId: string;
  runtimeTarget: {
    stack: "PAPERCLIP";
    adapter: "@spctre/paperclip";
    environment?: string;
  };
  companyId?: string;
  issueId?: string;
  goalId?: string;
  runStatus: string;
  taskContext?: Record<string, unknown>;
  emittedAt: string;
}

export class SpctreClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async emitEvidence(record: PaperclipEvidenceRecord): Promise<void> {
    const url = `${this.baseUrl}/api/v1/evidence`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(record),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Spctre evidence ingest failed: ${resp.status} ${body}`);
    }
  }

  async emitHeartbeat(record: HeartbeatRecord): Promise<void> {
    const url = `${this.baseUrl}/api/v1/evidence`;
    const payload = {
      decisionId: `paperclip-heartbeat-${Date.now()}`,
      agentId: record.agentId,
      workspaceId: record.workspaceId,
      tenantId: record.tenantId,
      environment: record.runtimeTarget.environment ?? "production",
      connector: "paperclip",
      action: "heartbeat",
      status: "ALLOW",
      reason: "Paperclip agent heartbeat.",
      ingestMode: "gateway",
      runtimeTarget: record.runtimeTarget,
      createdAt: record.emittedAt,
      rawEvidence: {
        type: record.type,
        runStatus: record.runStatus,
        companyId: record.companyId,
        issueId: record.issueId,
        goalId: record.goalId,
        taskContext: record.taskContext,
      },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Spctre heartbeat ingest failed: ${resp.status} ${body}`);
    }
  }
}
