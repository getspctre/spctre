import { SpctreClient } from "./client.js";
import { emitHeartbeatEvidence } from "./heartbeat.js";
import type {
  BeforeToolDispatchHook,
  DispatchContext,
  DispatchResult,
  HeartbeatPayload,
  PaperclipEvidenceRecord,
  SpctrePaperclipPluginOptions,
  TrustLevel,
} from "./types.js";

export class SpctrePaperclipPlugin {
  private readonly client: SpctreClient;
  private readonly agentId: string;
  private readonly tenantId: string;
  private readonly workspaceId: string;
  private readonly environment?: string;
  private readonly dryRun: boolean;

  constructor(options: SpctrePaperclipPluginOptions) {
    this.client = new SpctreClient(options.apiKey, options.baseUrl);
    this.agentId = options.agentId;
    this.tenantId = options.tenantId;
    this.workspaceId = options.workspaceId;
    this.environment = options.environment;
    this.dryRun = options.dryRun ?? false;
  }

  /**
   * Register with the Paperclip plugin-tool-dispatcher.
   * Call this from your Paperclip plugin's register() function:
   *   dispatcher.registerBeforeToolDispatch(plugin.beforeToolDispatch)
   *
   * Coordination note: Paperclip's execution-allowlist.ts and
   * execution-policy-bootstrap.ts already gate tool execution at the
   * orchestrator level. This hook fires AFTER Paperclip's own allowlist
   * check. Spctre governs individual tool-call semantics; Paperclip governs
   * task-level policy. Do not duplicate Paperclip's allowlist logic here.
   */
  register(dispatcher: { registerBeforeToolDispatch: (fn: BeforeToolDispatchHook) => void }): void {
    dispatcher.registerBeforeToolDispatch(this.beforeToolDispatch);
  }

  /**
   * Hook into Paperclip's plugin-tool-dispatcher.
   * Emits RuntimeDecisionEvidenceRecord with:
   *   - runtimeTarget.stack = "PAPERCLIP"
   *   - orchestratorRef: { platform: "paperclip", companyId, issueId, goalId } from dispatchContext
   *   - trustLevel from dispatchContext.trustPreset (from trust-preset-resolver)
   *   - triggerKind: "routine" if dispatchContext.isRoutine, else "interactive"
   *   - parentAgentId if dispatchContext carries orchestrator agent reference
   */
  beforeToolDispatch: BeforeToolDispatchHook = async (
    context: DispatchContext,
  ): Promise<DispatchResult> => {
    const decisionId = `paperclip-${context.toolName}-${Date.now()}`;
    const decidedAt = new Date().toISOString();
    const trustLevel: TrustLevel = context.trustPreset ?? "standard";
    const triggerKind = context.isRoutine ? "routine" : "interactive";

    const record: PaperclipEvidenceRecord = {
      decisionId,
      workspaceId: this.workspaceId,
      tenantId: this.tenantId,
      agentId: context.agentId ?? this.agentId,
      parentAgentId: context.parentAgentId,
      connector: "paperclip",
      action: context.toolName,
      toolName: context.toolName,
      toolArgs: context.toolArgs ?? {},
      runtimeTarget: {
        stack: "PAPERCLIP",
        adapter: "@spctre/paperclip",
        environment: context.environment ?? this.environment,
      },
      orchestratorRef: {
        platform: "paperclip",
        companyId: context.companyId,
        issueId: context.issueId,
        goalId: context.goalId,
      },
      trustLevel,
      triggerKind,
      status: "ALLOW",
      decidedAt,
      rawEvidence: context.rawContext,
      ingestMode: "gateway",
    };

    if (!this.dryRun) {
      void this.client.emitEvidence(record).catch((err: unknown) => {
        console.error("[spctre/paperclip] evidence emission failed:", err);
      });
    }

    return { action: "allow", decisionId };
  };

  /**
   * Emit a heartbeat evidence record to Spctre.
   * Call from your Paperclip plugin's onHeartbeat() handler.
   * Gives Spctre a real-time activity trail per agent-in-company.
   */
  async onHeartbeat(heartbeatPayload: HeartbeatPayload): Promise<void> {
    if (this.dryRun) return;
    await emitHeartbeatEvidence(
      this.client,
      heartbeatPayload,
      this.workspaceId,
      this.tenantId,
      this.environment,
    );
  }
}
