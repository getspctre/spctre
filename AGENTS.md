# AGENTS.md

Guidance for AI coding agents working in this repository. Human contributors
should start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## What this is

Spctre is a stack-neutral policy operations control plane for governed agent
systems. A pnpm monorepo spanning TypeScript (Next.js control plane, packages,
CLI), Go (ingest/operations worker), and Rust (napi-rs policy-evaluation
addon), over Postgres 18. Node.js 25+, Go, and Rust are all required.

## Key commands

```bash
pnpm install                 # installs + builds the Rust addon and TS packages
docker compose up -d         # Postgres 18 (host port 5433), worker, MCP server
pnpm dev                     # start apps/web

pnpm typecheck               # all TypeScript packages (Go: go build/test)
pnpm lint                    # ESLint + import-boundary rules
pnpm test                    # package tests + web integration tests
pnpm generate                # regenerate OpenAPI JSON + SDK types after spec edits
pnpm migrate                 # run DB migrations

# Go tests. The worker links the Rust policy kernel behind a build tag, and the
# stub for builds without it fails closed by design — so a plain `go test ./...`
# reports the policy-kernel tests as failures rather than skips. Build the kernel
# first and pass the tag, as CI does:
cd packages/policy-schema/native && cargo build --release --no-default-features
cd apps/worker && go test -tags spctre_policy_kernel ./...
cd packages/policy-schema/native && cargo test           # Rust tests
```

Run before opening a PR: `pnpm oss:check && pnpm typecheck && pnpm lint`.

## Conventions that matter

- **Next.js changes:** Consult the installed Next.js 16 documentation before
  changing Next-specific behavior, APIs, conventions, or file structure.
- **Respect the web app layering.** Routes/actions are thin → domain services
  (`apps/web/lib/domains/<domain>/service.ts`) hold logic → repositories
  (`apps/web/lib/repositories/`) hold SQL. **Only repositories import
  `@/lib/db`** (enforced by lint and tests). New API routes use `withApiRoute`
  from `@/lib/platform/api-route`. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Open-core boundary.** Everything here is Apache 2.0. Open-source code must
  not import commercial-only slot implementations; slot contracts are injected
  at runtime by plan. `pnpm oss:check` enforces this.
- **Contracts are generated.** Edit the OpenAPI source at
  `packages/api-contracts/src/openapi.ts`, then run `pnpm generate`. Do not
  hand-edit generated SDK files.
- **Database.** No ORM — the `postgres` client directly. Schema changes need a
  new idempotent migration in `db/migrations/`.
- **Commits require DCO sign-off** (`git commit -s`).

## Verifying a change

Match the change to its suite: TS → `pnpm test` / package tests; worker →
`go test ./...`; native addon → `cargo test`; web behavior →
`pnpm --filter @spctre/web test:integration` (needs Postgres). Don't rely on
typecheck alone for runtime behavior.
