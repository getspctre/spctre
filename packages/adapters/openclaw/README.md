# @spctre/openclaw

OpenClaw adapter for Spctre runtime governance. The adapter registers with
OpenClaw's agent harness runtime and evaluates tool calls before execution.

## Install

```sh
npm install @spctre/openclaw
```

## Usage

```ts
import { SpctreOpenClawAdapter } from "@spctre/openclaw";

const adapter = new SpctreOpenClawAdapter({
  apiKey: process.env.SPCTRE_API_KEY!,
  baseUrl: "https://app.spctre.ai/api/v1",
  agentId: "openclaw-agent-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  environment: "production",
});

adapter.register(runtime);
```

The registered hook calls Spctre's `/evaluate` endpoint before a tool executes
and emits a `RuntimeDecisionEvidenceRecord` to `/evidence` with:

- `runtimeTarget.stack = "OPENCLAW"`
- `triggerKind = "scheduled"` for cron contexts
- `triggerKind = "gateway_message"` for channel contexts
- `triggerKind = "interactive"` by default
- execution context hints from the OpenClaw hook context
- `parentAgentId` when routing parent metadata is present

Enforcement is fail-closed for blocking Spctre outcomes:

| Spctre status | OpenClaw outcome                 |
| ------------- | -------------------------------- |
| `ALLOW`       | allow                            |
| `WARN`        | allow and emit evidence          |
| `DENY`        | block                            |
| `ESCALATE`    | block with the escalation reason |

`ESCALATE` currently uses Spctre's escalation queue as the approval authority
and blocks the OpenClaw tool call until the agent retries after review. It does
not yet bridge to OpenClaw's native deferred approval primitive.

`dryRun: true` disables network calls and always allows tool execution. This is
useful for wiring checks before enabling enforcement.
