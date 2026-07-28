# Contributing to Spctre

Thanks for helping improve Spctre. The repository uses an open-core boundary:
this repository contains the Apache 2.0 open-source implementation.

New here? Read [ARCHITECTURE.md](ARCHITECTURE.md) first — it explains how the
code is layered and where a given change belongs.

## Prerequisites

- **Node.js 25+** and **pnpm** (`corepack enable`)
- **Go** and **Rust** (mandatory — the `policy-schema` install builds the Rust
  addon)
- **Docker** (for local Postgres 18)

## Local setup

```bash
cp .env.example .env
pnpm install          # also builds the Rust addon and TS packages (postinstall)
docker compose up -d  # Postgres 18 (host port 5433), migrations, worker, MCP server
pnpm dev              # starts apps/web
```

## Development workflow

Branch from `main`, keep changes focused, and open a PR. The pull-request
template lists what CI enforces.

Run the same checks CI runs before you push:

```bash
pnpm oss:check    # open-core boundary + license + raw-SQL + demo-fallback checks
pnpm typecheck    # all TypeScript packages (Go is checked by go build/test)
pnpm lint         # ESLint, including import-boundary rules
pnpm test         # package unit tests + web integration tests
```

Per-language test suites:

```bash
# TypeScript package tests
pnpm --filter @spctre/policy-schema test

# Web integration tests (needs a running Postgres from docker compose)
pnpm --filter @spctre/web test:integration

# Go worker tests
cd apps/worker && go test ./...

# Rust native addon tests
cd packages/policy-schema/native && cargo test
```

After editing the OpenAPI spec (`packages/api-contracts/src/openapi.ts`),
regenerate the spec JSON and SDK types:

```bash
pnpm generate
```

## Developer Certificate of Origin

Spctre uses DCO sign-off instead of a CLA. Every commit must include:

```text
Signed-off-by: Your Name <you@example.com>
```

You can add this automatically with:

```bash
git commit -s
```

By signing off, you certify the contribution under the Developer Certificate of
Origin 1.1: https://developercertificate.org/

## Community process

Please follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Use
[GitHub Discussions](https://github.com/getspctre/spctre/discussions) for
questions and early design conversations; use Issues for reproducible bugs and
scoped feature requests. The pull-request template lists the contribution
requirements enforced by CI.

Repository governance and maintainer responsibilities are described in
[GOVERNANCE.md](GOVERNANCE.md).

## Security

Do not open public issues for vulnerabilities. Follow `SECURITY.md`.
