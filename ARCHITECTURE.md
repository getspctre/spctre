# Architecture

This document orients contributors to how the Spctre codebase is organized and
where a given change belongs. For what each component _is_, see the
"Current Repository State" section of [README.md](README.md); this document
covers the internal patterns and boundaries.

## System shape

Spctre is a policy operations control plane for governed agent systems. The
product loop is:

```
policy changes → reviewed & published runtime controls → enforced agent
decisions → durable evidence → assurance & replay → better policy changes
```

Three runtime processes back that loop, over a single Postgres 18 database:

| Process                         | Language                            | Role                                                                                                                  |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                      | TypeScript (Next.js 16, App Router) | Control-plane UI + API (BFF). Authoring, review, evidence, compliance, admin.                                         |
| `apps/worker`                   | Go                                  | High-volume ingest and background jobs. Evidence writes, gateway/ingest side-effects, notifications, periodic sweeps. |
| `packages/policy-schema/native` | Rust (napi-rs)                      | Gateway/policy evaluation and tamper-evident operations-log hash chaining.                                            |

The web app is a **backend-for-frontend**: high-volume ingest routes delegate to
the Go worker over HTTP (see `apps/web/lib/platform/config.ts`,
`SPCTRE_EVIDENCE_INGEST_URL`, and the shared-secret `SPCTRE_WORKER_INTERNAL_SECRET`).
Everything else is served directly by `apps/web`.

## Repository layout

```
apps/web          Next.js control plane (UI + API routes)
apps/worker       Go ingest & runtime operations service
packages/
  policy-schema   Shared TS schema/types + Rust native addon
  cli             TypeScript CLI (init, watch, install-hook, ...)
  mcp-server      MCP transport server (modern STDIO + stateless Streamable HTTP)
  api-contracts   OpenAPI 3.1 spec source (src/openapi.ts)
  sdk             Generated TypeScript SDK (openapi-fetch)
  platform        Shared observability / metrics / classification
  ui, design-tokens  Shared UI components and tokens
db/migrations     Postgres 18 SQL migrations (idempotent runner)
```

Node.js 25+, Go, and Rust are all required to build the repo — the
`policy-schema` install builds the Rust addon.

## Web app patterns (`apps/web`)

The web app is layered. A change almost always lands in one of these layers, and
the layering is enforced by lint rules and boundary tests — respecting it is the
single most important thing for keeping the app maintainable.

**1. Route / server action (thin).** `app/api/*` routes and server actions do no
business logic. API routes wrap their handler in `withApiRoute` from
`@/lib/platform/api-route` (tracing + error envelopes) and call a domain service.

**2. Domain service (business logic).** Each product domain has a `service.ts`
under `lib/domains/<domain>/` (e.g. `evidence`, `compliance`, `policy`,
`review`, `gateway`). Services hold the logic and bind tenancy with
`runWithTenantContext` from `@/lib/tenant-context`.

**3. Repository (data access).** SQL lives in `lib/repositories/`, using the
`postgres` client. **Only repositories may import `@/lib/db`** — this is enforced
by `pnpm lint` and `tests/domain-boundaries.test.mts`. Services call
repositories, never raw SQL.

Tenant context is stored in `AsyncLocalStorage` (`lib/tenant-context.ts`), so
every query in a request is automatically tenant-scoped. Routes under
`app/[workspace]/*` are workspace-scoped UI surfaces.

Auth is session-backed with edge-level session-guard JWTs
(`lib/auth-session.ts`); OIDC and SAML are opt-in.

## Open-core boundary

Everything in this repository is Apache 2.0. Commercial-only capabilities are
implemented as **slots**: the slot _contracts_ live in the open-source tree and
are injected at runtime according to `SPCTRE_PLAN`
(`lib/feature-flags.ts`, `lib/feature-flags-server.ts`). Open-source code must
never import a commercial-only implementation directly.

`pnpm oss:check` enforces the boundary along with license, raw-SQL, and
demo-fallback rules. Run it before every PR.

## Go worker (`apps/worker`)

Pure Go. Entry point `cmd/`, logic in `internal/worker/`. Responsibilities:
evidence writes and gateway-ingest normalization, delegated trust side-effects,
token/runtime support endpoints, alerting-rule matching and notification
dispatch (Slack, Teams, PagerDuty, webhooks), and periodic jobs exposed at
`/internal/jobs/*` (`retention-sweep`, `verification-sweep`, `metrics-sweep`,
`escalation-sla`, `notification-sender`).

Set `SPCTRE_DISABLE_INTERNAL_SCHEDULER=1` to run request-driven only (for
scale-to-zero deployments); an external scheduler then hits the job endpoints.

## Policy schema & native addon (`packages/policy-schema`)

Two layers share one package:

- **TypeScript (`src/`)** — schema types and helpers for import/export,
  composition, review/publish readiness, evidence/simulation, and
  AGT-compatible bundles. AGT-native fields are preserved on import for
  round-trip fidelity.
- **Rust (`native/`, napi-rs)** — gateway/policy evaluation and operations-log
  hash-chain integrity. The addon is **lazy-loaded** on first native call
  (`src/native.ts`): the pure-TypeScript surface imports on any platform, and
  only evaluation/integrity calls require a prebuilt binary. Rebuild with
  `pnpm --filter @spctre/policy-schema build:native`.

## Data & contracts

- **Database** — Postgres 18. Migrations in `db/migrations/` run via an
  idempotent runner (`pnpm migrate`, and automatically on `docker compose up`).
  No ORM; the `postgres` client is used directly.
- **API contract** — OpenAPI 3.1, source of truth at
  `packages/api-contracts/src/openapi.ts`. After editing it, run `pnpm generate`
  to regenerate the spec JSON and the `@spctre/sdk` TypeScript types.

## Where does my change go?

| Change                              | Where                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| New API endpoint                    | Add the route (thin, `withApiRoute`) → a domain service → a repository. Update the OpenAPI spec + `pnpm generate`. |
| New business rule                   | The relevant `lib/domains/<domain>/service.ts`.                                                                    |
| New/changed SQL                     | A `lib/repositories/*` file, plus a new `db/migrations/*.sql`.                                                     |
| High-volume ingest / background job | `apps/worker/internal/worker/`.                                                                                    |
| Policy evaluation / integrity logic | `packages/policy-schema` (TS helpers, or `native/` for the hot path).                                              |
| Shared type used across surfaces    | `packages/policy-schema/src/types/`.                                                                               |

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the full local check suite,
and how to run each language's tests.
