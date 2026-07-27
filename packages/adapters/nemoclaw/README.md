# NemoClaw Sandbox Ingest Adapter

Go client for ingesting NemoClaw sandbox events into Spctre's evidence pipeline.

## What this covers

NemoClaw is an infrastructure sandbox runtime — not an agent framework. It wraps agent processes (OpenClaw, Hermes, LangChain) inside NVIDIA OpenShell containers and enforces network and filesystem policy at L3/L4. Unlike application-layer adapters that hook at the tool-call level, this adapter operates at the infrastructure layer: it receives structured events that NemoClaw emits when a sandboxed agent process performs a notable OS-level action (file writes, network calls, subprocess launches) and forwards them to Spctre as evidence records.

This fills the gap described in the runtime integration landscape: NemoClaw's L3/L4 enforcement was previously silent from Spctre's perspective. With this adapter, sandbox-layer ALLOW/DENY decisions appear alongside agent-layer tool-call evidence in the unified decision timeline.

## Wiring the client

```go
import "github.com/getspctre/spctre/packages/adapters/nemoclaw/nemoclaw"

client := nemoclaw.NewClient(
    "https://app.spctre.dev",  // SPCTRE_BASE_URL
    os.Getenv("SPCTRE_API_KEY"),
)

// Call this from your NemoClaw event handler / webhook receiver.
err := client.IngestSandboxEvent(ctx, nemoclaw.SandboxEvent{
    EventType:    "SANDBOX_ACTION",
    AgentID:      "agent-xyz",
    TenantID:     "tenant-abc",
    WorkspaceID:  "ws-main",
    SandboxName:  "inference-sandbox-01",
    Layer:        "INFRASTRUCTURE",
    ActionKind:   "network_call",
    ResourcePath: "https://api.openai.com/v1/chat/completions",
    Outcome:      "allowed",
    PolicyRef:    "net-policy-v2",
    EmittedAt:    time.Now().UTC(),
})
```

The client uses a 5-second HTTP timeout and does not retry on failure — callers are responsible for retry/backoff.

## SandboxEvent → Spctre evidence mapping

| `SandboxEvent` field | Spctre evidence field |
|---|---|
| `AgentID` | `agentId` |
| `TenantID` | `tenantId` |
| `WorkspaceID` | `workspaceId` |
| `ActionKind` | `action` |
| `Outcome` (`"allowed"` → `ALLOW`, `"blocked"` → `DENY`) | `status` |
| `PolicyRef` | `policyRefs[0]` |
| `SandboxName` | `runtimeTarget.sandboxName` |
| (constant) `"NEMOCLAW"` | `runtimeTarget.stack` |
| (constant) `"INFRASTRUCTURE"` | `layer` |
| `EventType`, `ActionKind`, `ResourcePath`, `RawPayload` | `rawEvidence` |
| `EmittedAt` | `createdAt` |
