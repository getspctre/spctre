# @spctre/paperclip

Spctre plugin for [Paperclip](https://paperclipai.com) — the agent
orchestration platform for teams of agents. This plugin hooks into
Paperclip's `plugin-tool-dispatcher` to emit durable, hash-chain-verified
evidence records for every governed tool call, and to relay heartbeat events
as structured evidence to the Spctre control plane.

> **Status:** Requires product decisions before shipping to production.
> See [`COORDINATION.md`](./COORDINATION.md) for the three coordination
> protocols (budget governance, approval workflows, trust levels) that must
> be configured before deploying both Paperclip and Spctre governance in the
> same workspace.

> **Schema dependency:** This package depends on `polly/schema-ts-additions`
> for `"PAPERCLIP"` in `RuntimeStack`, and `orchestratorRef` / `trustLevel`
> fields on `RuntimeDecisionEvidenceRecord`.

---

## Install

```sh
npm install @spctre/paperclip
# or
pnpm add @spctre/paperclip
```

---

## Usage

### 1. Register the plugin with the tool dispatcher

Call `plugin.register(dispatcher)` from your Paperclip plugin's `register()`
function. This wires `beforeToolDispatch` into Paperclip's
`plugin-tool-dispatcher` so Spctre sees every plugin tool call.

```typescript
import { SpctrePaperclipPlugin } from "@spctre/paperclip";

const plugin = new SpctrePaperclipPlugin({
  apiKey: process.env.SPCTRE_API_KEY!,
  baseUrl: process.env.SPCTRE_BASE_URL!,
  agentId: process.env.PAPERCLIP_AGENT_ID!,
  tenantId: process.env.SPCTRE_TENANT_ID!,
  workspaceId: process.env.SPCTRE_WORKSPACE_ID!,
  environment: "production",
});

// In your Paperclip plugin's register() function:
export function register(dispatcher: PaperclipPluginToolDispatcher) {
  plugin.register(dispatcher);
}
```

Evidence records are emitted asynchronously and never block tool dispatch.
If the Spctre ingest endpoint is unreachable, the tool call proceeds and the
emission error is swallowed. Monitor `/api/v1/ingest/evidence` health
separately.

### 2. Emit heartbeat evidence

Call `plugin.onHeartbeat(payload)` from your Paperclip plugin's
`onHeartbeat()` handler. This gives the Spctre control plane a real-time
activity trail per agent-in-company, not just governed tool calls.

```typescript
export async function onHeartbeat(payload: PaperclipHeartbeatPayload) {
  await plugin.onHeartbeat({
    agentId: payload.agentId,
    companyId: payload.companyId,
    issueId: payload.issueId,
    goalId: payload.goalId,
    runStatus: payload.status,
    taskContext: payload.context,
    timestamp: payload.timestamp,
  });
}
```

### 3. Dry-run mode

Pass `dryRun: true` to suppress all network calls during local development
or testing. The `beforeToolDispatch` hook still returns `allow` and a
`decisionId`, but no evidence is emitted.

```typescript
const plugin = new SpctrePaperclipPlugin({
  // ...
  dryRun: process.env.NODE_ENV === "development",
});
```

---

## Evidence fields

Each tool call emits a `RuntimeDecisionEvidenceRecord` with:

| Field | Value |
|---|---|
| `runtimeTarget.stack` | `"PAPERCLIP"` |
| `orchestratorRef.platform` | `"paperclip"` |
| `orchestratorRef.companyId` | from `dispatchContext.companyId` |
| `orchestratorRef.issueId` | from `dispatchContext.issueId` |
| `orchestratorRef.goalId` | from `dispatchContext.goalId` |
| `trustLevel` | from `dispatchContext.trustPreset` (default: `"standard"`) |
| `triggerKind` | `"routine"` if `dispatchContext.isRoutine`, else `"interactive"` |
| `parentAgentId` | from `dispatchContext.parentAgentId` if present |

---

## Coordination protocols

Before deploying Spctre alongside Paperclip's own governance layer, read
[`COORDINATION.md`](./COORDINATION.md). It documents three collision points
that require operator configuration:

1. **Budget governance** — which system owns which limit types
2. **Approval workflows** — how Spctre ESCALATE and Paperclip approvals
   co-exist without duplicating notifications
3. **Trust level as policy input** — how Paperclip's `trustPreset` flows
   into Spctre policy rules

---

## License

Apache-2.0
