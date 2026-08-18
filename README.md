# Spctre

Spctre is an open-source, stack-neutral policy operations control plane for
governed agent systems. It gives teams one place to author, review, compose,
publish, simulate, and prove the policies that govern production agent actions.

Its Rust policy kernel applies the same validation, composition, constraint, and
decision semantics across Node, Go, and WebAssembly delivery adapters. Spctre
works with cloud, framework, MCP, local, and custom runtimes—including AWS
Bedrock, Google ADK, Azure AI, LangChain, CrewAI, AutoGen, OpenAI Agents,
Antigravity CLI, and Kimi Code CLI.

Spctre can import and export policies compatible with the
[Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit).
That compatibility is one integration path, not a platform boundary; contracts
are published through the repository's OpenAPI definition and package
documentation.

```text
Spctre Control Plane
  - policy branches and revisions
  - reviews, approvals, and merge history
  - organization/workspace policy composition
  - simulation against historical actions
  - evidence retention and compliance exports
  - connector-specific business policy packs
        |
        v
Runtime Delivery Adapters
  - Node, Go/C ABI, and WebAssembly bindings
  - cloud, local, framework, MCP, and custom integrations
  - shared Rust policy-kernel semantics
  - identity, sandboxing, audit, and compliance integrations
        |
        v
Production Agent Actions
```

## Why Spctre Exists

Runtime enforcement answers an important question:

> Should this agent action be allowed right now?

Production teams also need answers to a different set of questions:

- Where did this policy come from?
- Who reviewed and approved it?
- Which organization, workspace, environment, connector, and agent does it apply to?
- What changed between the currently published policy and the proposed one?
- Would this policy have prevented a past incident?
- Would it block normal workflows if deployed?
- Which policy revision was active when a specific action was allowed or denied?
- Can we export evidence for security review, audit, or customer incident response?

Spctre is built for those operational questions.

## Governance Model

Spctre's tenant boundary maps to an organization or company. Workspaces map to
teams, product surfaces, departments, or agent groups inside that organization.

Policies are composed from multiple layers:

- **Organization policy:** shared baseline rules, immutable guardrails, security
  requirements, compliance constraints, and cross-team decisions.
- **Workspace policy:** team-specific rules, product logic, experiments, and local
  operating procedures that must still comply with organization policy.
- **Environment policy:** development, staging, production, incident mode, or
  customer-specific overlays.
- **Connector policy:** domain rules for concrete action surfaces such as refunds,
  deploys, CRM updates, support replies, file access, and external messages.

Spctre produces a composed, versioned policy bundle that delivery adapters
evaluate through one Rust policy kernel. The kernel owns schema validation,
layer composition, parameter-constraint matching, and decision rules, so Node,
Go, and WebAssembly integrations apply identical policy semantics. Every
published bundle has durable provenance:
branch, revision, author, reviewers, approval status, source policy documents,
target runtime stacks, generated runtime artifact hashes, and effective
timestamps.

## What's Included

Spctre combines a Next.js control plane, a Go operations worker, and a Rust
policy kernel, with Postgres for lifecycle, evidence, simulation, compliance,
and operations data.

- `apps/web`: Next.js 16 control plane with policy, review, evidence,
  compliance, operations, escalations, administration/account,
  onboarding, auth, alerting configuration, and agent surfaces, including workspace-scoped routes under
  `app/[workspace]/*`. APIs cover identity/auth, approvals, evidence,
  gateway+ingest, trust/context-budget, service keys/tokens, onboarding/device
  flow, workspace metadata, health/readiness, and OpenAPI docs at `/api-docs`.
- `apps/worker`: Go ingest and runtime operations service. It handles
  evidence writes, delegated gateway/ingest, trust-side effects,
  token/runtime support endpoints, custom alerting rules matching and notification
  dispatchers (Slack, Teams, PagerDuty, Webhooks), and periodic retention/verification/
  escalation/notification jobs, with health/readiness. Its policy adapter calls
  the Rust kernel through its C ABI rather than maintaining a second evaluator.
- `packages/policy-schema`: Shared TypeScript schema/types/helpers for policy
  import/export, review/publish readiness, evidence/simulation,
  retention/compliance, and AGT-compatible bundles. Parser behavior preserves
  AGT-native fields for round-trip compatibility. Its Rust crate in
  `packages/policy-schema/native` is the authoritative policy evaluator and
  operations-log hash-chain implementation. It ships a lazy-loaded Node addon,
  a C ABI/static library for the Go worker, and a portable WASM build target.
- `packages/cli`: TypeScript CLI for local and long-running agent workflows,
  including `init`, `watch`, `status`, `refresh`, `revoke`, `install-skill`,
  `install-hook`, `check`, and policy/evidence helpers. Maintains local
  runtime state and supports short-lived access tokens with automatic refresh.
- `packages/mcp-server`: MCP transport server (modern stdio and optional stateless Streamable HTTP)
  that authenticates to the control plane and scopes tool calls by
  workspace/agent identity with optional tool/connector allowlists.
- `packages/api-contracts` and `packages/sdk`: OpenAPI 3.1 contract source plus
  generated TypeScript SDK bindings used by app and integration clients.
- `db/migrations`: Postgres 18 schema baseline covering identity, OIDC/SAML auth,
  service tokens and refresh tokens, policy branches/revisions/approvals,
  decision gateway + HITL operations, runtime evidence ledgering, simulation,
  operations-log integrity, trust/context-budget governance, custom alerting rules
  and integrations, notifications, and device code flow.
- `docker-compose.yml`: Starts Postgres 18, migrations, web app, Go worker,
  and MCP server for local end-to-end development.

## Developer Resources

Public documentation is published at
[getspctre.github.io/spctre](https://getspctre.github.io/spctre). It is a
static, English-language reading surface built from the same MDX source as the
in-app help docs. Product and buyer information lives at
[spctre.dev](https://spctre.dev).

| Resource         | Where                          | Notes                                                                            |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| API reference UI | `GET /api-docs`                | Interactive Scalar docs, try-it-now playground                                   |
| OpenAPI 3.1 spec | `GET /api/v1/openapi.json`     | Machine-readable; source lives in `packages/api-contracts/src/openapi.ts`        |
| TypeScript SDK   | `packages/sdk` (`@spctre/sdk`) | Typed `openapi-fetch` client generated from the spec                             |
| Python SDK       | `pnpm generate:python-sdk`     | Generates `target/sdk-python/` via `openapi-generator-cli`                       |
| CLI              | `packages/cli` (`@spctre/cli`) | `spctre init`, `watch`, `status`, `install-skill`, `install-hook`                |
| MCP server       | `packages/mcp-server`          | Modern STDIO + stateless Streamable HTTP governance server for AI agent runtimes |

See the CLI, SDK, and MCP package documentation for integration guidance.

Regenerate the spec JSON and SDK types after editing the spec:

```sh
pnpm generate
```

## Environment Variables

Two env files are used locally:

- **`.env`** (copy from `.env.example`) — shared by web, worker, and mcp-server. Used by Docker Compose and direct process invocations.
- **`apps/web/.env.local`** (copy from `apps/web/.env.local.example`) — web-only Next.js overrides. Takes precedence over `.env` for `pnpm dev`.

For a quick local setup, copying `.env.example` to `.env` and filling in the required values is sufficient.

### Database

| Variable             | Required | Description                        |
| -------------------- | -------- | ---------------------------------- |
| `DATABASE_URL`       | Yes      | Postgres connection string         |
| `DATABASE_POOL_SIZE` | No       | Connection pool size (default: 10) |

### Session and auth

| Variable                      | Required | Description                                                                     |
| ----------------------------- | -------- | ------------------------------------------------------------------------------- |
| `SPCTRE_SESSION_GUARD_SECRET` | Yes      | Secret for signing edge-level session guard JWTs. Must be a long random string. |
| `SPCTRE_SESSION_TTL_HOURS`    | No       | Session lifetime in hours (default: 24)                                         |

### Service identity

| Variable                        | Required                  | Description                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPCTRE_SERVICE_TOKEN`          | Yes (for evidence ingest) | Bearer token that runtimes must include when calling `POST /api/evidence`                                                                                                                                                                                                                                                                                     |
| `SPCTRE_EVIDENCE_INGEST_URL`    | No                        | Internal base URL for delegating runtime API calls from web to the Go worker, e.g. `http://worker:18080` in Docker Compose. Currently covers `POST /api/evidence`, service-token `POST /api/gateway/decide`, gateway webhook ingest, token refresh/revoke, trust/context-budget runtime APIs, economic governance APIs, and internal gateway queue mutations. |
| `SPCTRE_WORKER_INTERNAL_SECRET` | No                        | Shared secret used by the web BFF when delegating browser-authenticated and runtime governance mutations to the Go worker. Required on both web and worker to delegate escalation claim/resolve writes and economic governance requests.                                                                                                                      |
| `SPCTRE_PROVISIONING_SECRET`    | No                        | Shared secret accepted by `POST /api/internal/provisioning/tenant`, which creates the tenant, workspace, owner and baseline policy for a completed hosted checkout. Required only where a checkout surface provisions tenants; unset leaves the endpoint returning 500.                                                                                       |

### Feature flags

| Variable               | Default  | Description                                                                                         |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `LOCAL_SIGNUP_ENABLED` | `false`  | Set to `true` to expose `/signup` for local development user creation. Do not enable in production. |
| `GATEWAY_ENABLED`      | `false`  | Enable the decision gateway and HITL flow.                                                          |
| `GATEWAY_MODE`         | `HYBRID` | Gateway evaluation mode: `HYBRID`, `ENFORCE`, or `OBSERVE`.                                         |
| `OIDC_ENABLED`         | `false`  | Set to `true` to enable OIDC login.                                                                 |
| `SAML_ENABLED`         | `false`  | Set to `true` to enable SAML 2.0 login.                                                             |

### Demo tenant overrides

| Variable                   | Required | Description                             |
| -------------------------- | -------- | --------------------------------------- |
| `SPCTRE_DEMO_TENANT_ID`    | No       | Override the seeded demo tenant UUID    |
| `SPCTRE_DEMO_WORKSPACE_ID` | No       | Override the seeded demo workspace UUID |

### OIDC / SSO

Set `OIDC_ENABLED=true` to show the SSO button on the login page and activate
`/api/auth/oidc/authorize` and `/api/auth/oidc/callback`.

| Variable                 | Required   | Description                                                                                                |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `OIDC_PROVIDER_ISSUER`   | If enabled | IdP issuer URL (e.g. `https://accounts.google.com`)                                                        |
| `OIDC_CLIENT_ID`         | If enabled | OAuth client ID                                                                                            |
| `OIDC_CLIENT_SECRET`     | If enabled | OAuth client secret                                                                                        |
| `OIDC_REDIRECT_URI`      | If enabled | Must match the redirect URI registered with the IdP (e.g. `https://app.spctre.dev/api/auth/oidc/callback`) |
| `OIDC_SCOPES`            | No         | Space-separated scopes (default: `openid profile email`)                                                   |
| `OIDC_DEFAULT_TENANT_ID` | No         | Tenant to associate with the default OIDC provider                                                         |

### SAML 2.0 SSO

Set `SAML_ENABLED=true` to activate `/api/auth/saml/authorize` and
`/api/auth/saml/callback`. The IdP entry point URL and signing certificate are
configured per-tenant in **Admin → Authentication settings** and stored in the
database. Download SP metadata from `GET /api/auth/saml/metadata` and paste it
into your IdP (Okta, Azure AD, PingOne, etc.) to complete the trust setup.

| Variable            | Required   | Description                                                                                                                      |
| ------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SAML_SP_ENTITY_ID` | If enabled | Service provider entity ID, typically the app's base URL (e.g. `https://app.spctre.dev`)                                         |
| `SAML_ACS_URL`      | If enabled | Assertion consumer service URL where the IdP will POST the `SAMLResponse` (e.g. `https://app.spctre.dev/api/auth/saml/callback`) |

### Passkeys (WebAuthn)

| Variable          | Required | Description                                                              |
| ----------------- | -------- | ------------------------------------------------------------------------ |
| `PASSKEY_RP_ID`   | No       | Relying party ID, must match the hostname (default: `localhost`)         |
| `PASSKEY_RP_NAME` | No       | Relying party display name shown during registration (default: `Spctre`) |

### Worker

| Variable                                        | Required | Description                                                                                                                                                                  |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_HTTP_PORT`                              | No       | HTTP port for the Go worker API, health, readiness, and metrics endpoints (default: `18080`)                                                                                 |
| `GATEWAY_ENABLED`                               | No       | Must match the web setting when service-token gateway decisions are delegated to the Go worker.                                                                              |
| `GATEWAY_MODE`                                  | No       | Gateway evaluation mode returned by the Go worker for delegated gateway decisions (default: `HYBRID`).                                                                       |
| `SPCTRE_WORKER_INTERNAL_SECRET`                 | No       | Shared secret accepted by internal worker-only mutation endpoints.                                                                                                           |
| `WORKER_RETENTION_INTERVAL_MINUTES`             | No       | Evidence retention sweep interval in minutes (default: `1440`)                                                                                                               |
| `WORKER_VERIFICATION_INTERVAL_MINUTES`          | No       | Verification sweep interval in minutes (default: `360`)                                                                                                                      |
| `WORKER_METRICS_INTERVAL_SECONDS`               | No       | Metrics sweep interval in seconds (default: `300`)                                                                                                                           |
| `WORKER_ESCALATION_SLA_INTERVAL_MINUTES`        | No       | Escalation SLA monitor interval in minutes (default: `5`)                                                                                                                    |
| `WORKER_NOTIFICATION_WEBHOOK_URL`               | No       | Optional outbound notification webhook. When set, the Go worker sends production `DENY` alerts and escalation SLA reminders, then audits each attempt in the operations log. |
| `WORKER_NOTIFICATION_INTERVAL_MINUTES`          | No       | Outbound notification sender interval in minutes (default: `5`)                                                                                                              |
| `WORKER_NOTIFICATION_TIMEOUT_SECONDS`           | No       | Outbound notification webhook timeout in seconds (default: `10`)                                                                                                             |
| `WORKER_ECONOMIC_BUDGET_SWEEP_INTERVAL_MINUTES` | No       | Economic budget sweep interval in minutes (default: `60`)                                                                                                                    |

### MCP server

| Variable                         | Required  | Description                                                           |
| -------------------------------- | --------- | --------------------------------------------------------------------- |
| `SPCTRE_MCP_TRANSPORT`           | No        | Transport mode: `stdio` (default) or `http`                           |
| `SPCTRE_MCP_HTTP_PORT`           | If `http` | HTTP port for the MCP server (default: `3100`)                        |
| `SPCTRE_MCP_HTTP_PATH`           | No        | Stateless Streamable HTTP endpoint path (default: `/mcp`)             |
| `SPCTRE_MCP_REQUIRE_BEARER_AUTH` | No        | Must remain `true`; HTTP transport refuses to start otherwise         |
| `SPCTRE_API_URL`                 | Yes       | Control plane URL the MCP server calls (e.g. `http://localhost:3000`) |
| `SPCTRE_WORKSPACE_ID`            | Yes       | Workspace to scope all MCP tool calls                                 |
| `SPCTRE_AGENT_ID`                | No        | Agent identity reported to the control plane (default: `mcp-server`)  |
| `SPCTRE_API_TOKEN`               | STDIO     | Short-lived access token for MCP server auth                          |
| `SPCTRE_API_REFRESH_TOKEN`       | STDIO     | Long-lived refresh token; auto-rotates the access token               |
| `SPCTRE_ALLOWED_TOOLS`           | No        | Comma-separated allowlist of MCP tool names. Empty = allow all.       |
| `SPCTRE_ALLOWED_CONNECTORS`      | No        | Comma-separated allowlist of connector names. Empty = allow all.      |

### CLI agent overrides

These variables override the corresponding fields in `.spctre/config.json` at
runtime and are never written back to disk. Set them in shell, CI, or a
secrets manager — they are not web app env vars and do not belong in `.env.local`.

| Variable           | Overrides         | Notes                                                                |
| ------------------ | ----------------- | -------------------------------------------------------------------- |
| `SPCTRE_API_TOKEN` | `token`           | Bypasses automatic token rotation — the caller manages the lifecycle |
| `SPCTRE_URL`       | `controlPlaneUrl` | Override the control plane URL without re-running init               |
| `SPCTRE_WORKSPACE` | `workspaceId`     | Override workspace identity                                          |
| `SPCTRE_AGENT`     | `agentId`         | Override agent identity                                              |

## Local Development

Requires Node.js 25+, Docker, Go, and Rust (the Go worker and Rust policy
core are mandatory parts of the stack, not optional components).

```sh
cp .env.example .env
# pnpm install runs postinstall, which builds the Node adapter and TypeScript packages.
pnpm install && docker compose up -d && pnpm dev
```

`docker compose up -d` starts a Postgres 18 container on port **5433** (remapped
from 5432 to avoid conflicts with a system Postgres installation) and runs
the schema baseline and any later SQL migrations in `db/migrations`
automatically on first start (fresh volume). `docker compose` is optional for
UI-only work.

Local compose also starts:

- Go worker inside the Compose network as `http://worker:18080`
- MCP server at `http://localhost:3100`

The compose file sets `PGDATA=/var/lib/postgresql/data/18`, which is required by
the Postgres 18 Docker image layout. If you upgraded this project from an older
Postgres image and do not need to preserve local development data, reset the old
volume once:

```sh
docker compose down -v
docker compose up -d
```

If you need to preserve an existing local database, use `pg_dump`/`pg_restore` or
`pg_upgrade` instead of deleting the volume.

Run the following after adding a migration:

```sh
pnpm migrate
```

Solo developer onboarding:

```sh
pnpm --filter @spctre/cli build

# One-time init: opens a browser tab for approval, writes .spctre/config.json,
# downloads the starter bundle, and sends a boot heartbeat.
pnpm exec spctre init \
  --url http://localhost:3000 \
  --workspace default \
  --agent solo-agent

# Background watch: keep bundle current and send periodic heartbeats.
pnpm exec spctre watch --heartbeat

# Check connection status, token expiry, and policy freshness.
pnpm exec spctre status --check

# Install local developer harness adapters for evidence capture (observe mode).
pnpm exec spctre install-hook --claude --mode observe
pnpm exec spctre install-hook --codex --mode observe
pnpm exec spctre install-hook --gemini --mode observe
pnpm exec spctre install-hook --antigravity --mode observe
pnpm exec spctre install-hook --kimi --mode observe

# Optional local blocking adapter mode for development harnesses.
pnpm exec spctre install-hook --claude --enforce
pnpm exec spctre install-hook --antigravity --enforce

# Optional agent guidance: install the Spctre skill.
pnpm exec spctre install-skill --claude
pnpm exec spctre install-skill --codex
pnpm exec spctre install-skill --gemini
pnpm exec spctre install-skill --antigravity
pnpm exec spctre install-skill --kimi

# Revoke tokens and disconnect (re-run init to reconnect).
pnpm exec spctre revoke
```

The CLI issues a short-lived access token (1 hour) and a long-lived refresh token
(90 days) at init. Access tokens rotate automatically before expiry — no manual
intervention needed for long-running agents.

### Agent Harness Setup

`spctre init` connects the local agent to the control plane. Skills and hooks are
optional harness-specific helpers that sit alongside that connection:

- **Skills:** `spctre install-skill --claude` copies the Spctre skill into
  `.claude/skills/spctre/`; `spctre install-skill --codex` copies it into
  `.codex/skills/spctre/`; `spctre install-skill --gemini` copies it into
  `.gemini/skills/spctre/`; `spctre install-skill --antigravity` copies it into
  `.agents/skills/spctre/` (auto-read by the Antigravity IDE and agy CLI);
  `spctre install-skill --kimi` copies it into `.kimi-code/skills/spctre/`.
  Skills give agents policy-aware operating instructions.
- **Hooks:** `spctre install-hook --claude` writes the Claude Code PreToolUse hook
  to `.claude/settings.json`; `spctre install-hook --codex` writes the Codex
  PreToolUse hook to `.codex/hooks.json`; `spctre install-hook --gemini` writes
  the Gemini CLI BeforeTool hook to `.gemini/settings.json`; `spctre install-hook
--antigravity` writes the Antigravity (IDE + `agy` CLI) PreToolUse hook to
  `.agents/hooks.json`; `spctre install-hook --kimi` adds the Kimi Code CLI
  PreToolUse hook as a `[[hooks]]` entry in `~/.kimi-code/config.toml`.
  Hooks are local developer harness adapters: by default they evaluate governed tool calls,
  send heartbeats, register evidence, and warn without blocking. Use
  `spctre install-hook --enforce` to opt into local blocking on `DENY`. Production
  enforcement belongs to the configured runtime adapter.

Use `--global` with either install command to write to the user's global harness
configuration instead of the current project. Kimi Code has no project-scoped
`config.toml`, so `install-hook --kimi` always writes the user-level file; the
managed entry is delimited by comment markers and spliced in without reformatting
the rest of the file. Kimi is also fail-open — it allows the tool call when a hook
errors or times out — so treat `--enforce` there as a developer guardrail and put
real enforcement in the runtime gateway.

Example evidence ingest:

```sh
curl -X POST http://localhost:3000/api/v1/evidence \
  -H 'authorization: Bearer <service-key>' \
  -H 'content-type: application/json' \
  -d '{
    "decisionId": "runtime-decision-demo-1",
    "tenantId": "tenant-demo",
    "workspaceId": "default",
    "environment": "production",
    "runtimeTarget": { "stack": "LOCAL", "adapter": "spctre-local" },
    "agentId": "support-agent-7",
    "connector": "stripe",
    "action": "refund.create",
    "status": "DENY",
    "reason": "Refund requires manager approval.",
    "policyRefs": ["stripe.refund.manager_approval"],
    "artifactHash": "sha256:demo",
    "policyContext": [
      {
        "scope": "WORKSPACE",
        "branchId": "br-demo",
        "revisionId": "rev-demo",
        "artifactHash": "sha256:demo"
      }
    ],
    "latencyMs": 1,
    "createdAt": "2026-04-30T00:00:00.000Z"
  }'
```

With Docker Compose, the public web route accepts the request at
`http://localhost:3000/api/evidence` and delegates ingestion to the Go worker via
`SPCTRE_EVIDENCE_INGEST_URL=http://worker:18080`.

## Policy Kernel Development

The Rust kernel is the single source of evaluation semantics. Delivery
adapters bind to it: Node through the lazy-loaded N-API addon, the Go worker
through the C ABI/static library, and browser or edge consumers through the
`wasm32-unknown-unknown` artifact. Do not add policy decisions or composition
rules to an adapter; add them to `packages/policy-schema/native` and cover them
with kernel tests.

Run the relevant checks after changing the kernel or an adapter:

```sh
# Go worker
(cd apps/worker && go test ./...)

# Rust policy/integrity core (unit tests only, no .node required)
(cd packages/policy-schema/native && cargo test)

# Node adapter (also runs automatically via pnpm install)
pnpm --filter @spctre/policy-schema build:native

# C ABI/static library used by the Go adapter
(cd packages/policy-schema/native && cargo build --release --no-default-features)

# Portable WASM kernel (install the target for the active toolchain once)
(
  cd packages/policy-schema/native
  toolchain="$(rustup show active-toolchain | awk '{print $1}')"
  rustup target add --toolchain "$toolchain" wasm32-unknown-unknown
  rustup run "$toolchain" cargo build --release --target wasm32-unknown-unknown \
    --no-default-features --features wasm
)
```

### Manual Code-Quality & Security Scans

For on-demand dead-code analysis and dependency/secrets auditing, you can run:

```sh
# Dead-code analysis via Knip (detects unused files/exports)
pnpm lint:deadcode

# Security audit (Gitleaks file secrets check + OSV package vulnerability scanner)
pnpm lint:security

# Run all linters and code-quality checks sequentially
pnpm lint:all
```
