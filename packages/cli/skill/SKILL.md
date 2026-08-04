---
name: spctre
description: >
  Policy governance for agent actions. Before taking any governed action —
  calling a connector, executing a deployment, writing to a database, sending
  an external message — check the Spctre policy bundle and report the decision
  as evidence. Trigger: any governed external action.
---

# Spctre Skill

You are a policy-aware agent connected to the Spctre control plane. Before taking
governed local developer actions, check the Spctre policy bundle when the project
has been initialized. Spctre records local evidence and provenance; production
runtime enforcement belongs to AGT or the configured runtime adapter.

## When to invoke this skill

Check the bundle **before** any action that:

- Calls an external connector (Stripe, Salesforce, Zendesk, Slack, GitHub, etc.)
- Executes a deployment or infrastructure change
- Writes to a production database
- Sends an external message or email
- Performs any bulk or irreversible operation

Read operations and purely internal computation do not require a check.

---

## Step 0 — Verify setup

Before doing anything else, confirm the local config exists:

```bash
test -f .spctre/config.json && echo "configured" || echo "not configured"
```

**If not configured**, tell the human:

> Spctre is not initialized in this project. Run this once to connect:
>
> ```bash
> npx @spctre/cli init
> ```
>
> With explicit values (preferred for production):
>
> ```bash
> npx @spctre/cli init \
>   --workspace  my-workspace \
>   --agent      my-agent-id \
>   --environment production
> ```
>
> Then start the background watch loop to keep the bundle current:
>
> ```bash
> npx @spctre/cli watch --heartbeat &
> ```

For production or irreversible actions, wait for the human to complete init or
use the configured AGT/runtime enforcement path.

**If configured but `spctre-policy.json` is missing**, pull the bundle once:

```bash
npx @spctre/cli sync
```

---

## Step 1 — Read config

Read `.spctre/config.json` at startup. It gives you everything you need:

```json
{
  "controlPlaneUrl": "https://your-control-plane.example.com",
  "workspaceId": "ws-...",
  "agentId": "my-agent-id",
  "environment": "production",
  "token": "spctre_dev_...",
  "bundlePath": "spctre-policy.json",
  "policyContext": [
    { "scope": "WORKSPACE", "branchId": "...", "revisionId": "...", "artifactHash": "..." }
  ]
}
```

`SPCTRE_API_TOKEN`, `SPCTRE_URL`, `SPCTRE_WORKSPACE`, and `SPCTRE_AGENT` env vars
override the corresponding config fields at runtime and are never written back
to disk — use them in containers and CI.

---

## Step 2 — Detect bundle changes cheaply

Do **not** re-read the full bundle on every tick. Stat `.spctre/last-sync.json`
and compare `artifactHash`. Reload `spctre-policy.json` only when the hash
changes.

```typescript
import { readFileSync } from "fs";

let cachedHash: string | null = null;
let bundle: PolicyBundle | null = null;

function getBundle(): PolicyBundle {
  const lastSync = JSON.parse(readFileSync(".spctre/last-sync.json", "utf8"));
  if (lastSync.artifactHash !== cachedHash) {
    const config = JSON.parse(readFileSync(".spctre/config.json", "utf8"));
    bundle = JSON.parse(readFileSync(config.bundlePath, "utf8"));
    cachedHash = lastSync.artifactHash;
  }
  return bundle!;
}
```

---

## Step 3 — Check an action before running it

Evaluate the action against the bundle before executing:

```typescript
import { evaluateDecision } from "@spctre/policy-schema";

const result = evaluateDecision({
  connector: "stripe",
  action: "refund.bulk",
  domains: ["billing"],
  rules: getBundle().rules,
});

// result.status:      "ALLOW" | "DENY" | "WARN"
// result.reason:      human-readable explanation
// result.matchedRefs: ["stripe.refund.bulk.deny"]
```

**If `@spctre/policy-schema` is not available**, evaluate manually: find the
first rule whose `connectors`, `actions`, and `domains` intersect the request;
return its `effect`. If no rule matches, the default is `ALLOW`.

### Decision contract

| Status  | What to do                                                                               |
| ------- | ---------------------------------------------------------------------------------------- |
| `ALLOW` | Proceed. Report the decision.                                                            |
| `WARN`  | Proceed with caution. Flag it in evidence. Tell the human.                               |
| `DENY`  | In observe mode, warn and report evidence. In enforce mode, stop and tell the human why. |

---

## Step 4 — Report the decision as evidence

Report **every** governed decision — allow, deny, and warn. This populates the
audit trail. Do not let evidence reporting failure block a decision that already
evaluated as `ALLOW` — log locally and continue. Local Spctre hooks default to
observe mode; only hooks installed with `--enforce` block on `DENY`.

**Via CLI (preferred when shell access is available):**

```bash
npx @spctre/cli ingest --payload '{
  "decisionId":    "<unique-id>",
  "tenantId":      "<from config>",
  "workspaceId":   "<from config>",
  "environment":   "<from config>",
  "runtimeTarget": { "stack": "LOCAL", "adapter": "my-agent" },
  "agentId":       "<from config>",
  "connector":     "stripe",
  "action":        "refund.bulk",
  "status":        "DENY",
  "reason":        "Denied by rule stripe.refund.bulk.deny: Block bulk refunds without approval",
  "policyRefs":    ["stripe.refund.bulk.deny"],
  "artifactHash":  "<from bundle or config>",
  "policyContext": <policyContext array from config>,
  "latencyMs":     4,
  "createdAt":     "<ISO timestamp>",
  "rawEvidence":   { "requestedAmount": 5000 }
}'
```

**Via direct POST (when shell access is unavailable):**

```
POST {controlPlaneUrl}/api/evidence
Authorization: Bearer {token}
Content-Type: application/json

{ ...AgtRuntimeDecisionInput }
```

Both `token` and `controlPlaneUrl` come from `.spctre/config.json`.

---

## Token lifecycle (for awareness, not action)

Tokens rotate automatically — no human intervention required under normal
operation. The CLI rotates the short-lived access token (1 hour TTL) via a
90-day refresh token before every `sync`, `ingest`, or `watch` cycle.

If the refresh token expires after 90 days of zero connectivity, the CLI exits
with: `Refresh token expired. Run spctre init to reconnect.` Tell the human to
run `npx @spctre/cli init` once; workspace and agent config are preserved.

---

## Human setup reference

Surface these commands when prompting the human to set up or debug Spctre.

| Command                                                     | What it does                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npx @spctre/cli init`                                      | One-time connect: opens browser, approves token, downloads bundle                            |
| `npx @spctre/cli watch --heartbeat`                         | Background loop: keep bundle current + send heartbeats                                       |
| `npx @spctre/cli sync`                                      | Pull the latest bundle once                                                                  |
| `npx @spctre/cli status --check`                            | Check connection, token expiry, and policy freshness                                         |
| `npx @spctre/cli revoke`                                    | Revoke tokens and remove local config                                                        |
| `npx @spctre/cli install-skill --claude`                    | Drop this SKILL.md into `.claude/skills/spctre/`                                             |
| `npx @spctre/cli install-skill --codex`                     | Drop this SKILL.md into `.codex/skills/spctre/`                                              |
| `npx @spctre/cli install-skill --gemini`                    | Drop this SKILL.md into `.gemini/skills/spctre/`                                             |
| `npx @spctre/cli install-skill --antigravity`               | Install the Antigravity skill at `.agents/skills/spctre/` (auto-read by the IDE and agy CLI) |
| `npx @spctre/cli install-hook --claude --mode observe`      | Install the Claude Code local evidence adapter                                               |
| `npx @spctre/cli install-hook --codex --mode observe`       | Install the Codex local evidence adapter                                                     |
| `npx @spctre/cli install-hook --gemini --mode observe`      | Install the Gemini CLI local evidence adapter                                                |
| `npx @spctre/cli install-hook --antigravity --mode observe` | Install the Antigravity CLI (agy) local evidence adapter                                     |
| `npx @spctre/cli install-hook --claude --enforce`           | Opt into local blocking on DENY for Claude Code                                              |
| `npx @spctre/cli install-hook --antigravity --enforce`      | Opt into local blocking on DENY for Antigravity CLI (agy)                                    |

---

## Critical rules

- **Prefer a policy check** for governed local actions. The check should happen
  before the action executes when Spctre is initialized.
- **On DENY, respect the configured mode.** Observe-mode hooks warn and report
  evidence without blocking. Enforce-mode hooks stop and tell the human why the
  action was blocked.
- **On WARN, proceed but flag.** Always include the warn status in evidence.
- **Report every governed decision** — ALLOW, DENY, and WARN. Silent decisions
  defeat the audit trail.
- **Reload the bundle when the hash changes.** Policy can be updated by the
  watch loop at any time; stale in-memory state is a governance gap.
- **Do not block on evidence reporting.** If the POST to `/api/evidence` fails,
  log it locally and continue. Evidence ingestion failure must not block a
  decision already evaluated as ALLOW.
