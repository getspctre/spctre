# @spctre/web

The Spctre control plane — a Next.js 16 (App Router, TypeScript) application that
serves both the UI and the API (backend-for-frontend) for the policy operations
platform.

This is an internal workspace app, not a published package.

## Run it

From the repository root:

```bash
docker compose up -d   # Postgres 18 + worker + MCP server
pnpm dev               # starts this app
```

## Layout

- `app/[workspace]/*` — workspace-scoped UI surfaces (policies, review, evidence,
  compliance, agents, escalations, simulate, packs, ...).
- `app/api/*` — API routes. High-volume ingest routes delegate to the Go worker.
- `lib/domains/<domain>/service.ts` — business logic per product domain.
- `lib/repositories/*` — data access (the only place that imports `@/lib/db`).
- `lib/platform/*` — API-route wrapper, tracing, and worker-delegation config.

The layering (thin route → domain service → repository), tenant scoping, and the
open-core slot boundary are described in the repository
[ARCHITECTURE.md](../../ARCHITECTURE.md).

## Tests

```bash
pnpm --filter @spctre/web test:integration   # needs a running Postgres
```

## License

Apache-2.0.
