# syntax=docker/dockerfile:1

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS base
RUN if command -v corepack >/dev/null 2>&1; then \
			corepack enable && corepack prepare pnpm@11.1.1 --activate; \
		else \
			npm install -g pnpm@11.1.1; \
		fi

# ── Stage 2: install root deps (postgres + tsx) ───────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Workspace member stubs — pnpm needs every manifest present to parse the lockfile,
# even when filtering to the root package only.
COPY apps/web/package.json           ./apps/web/
COPY packages/api-contracts/package.json  ./packages/api-contracts/
COPY packages/cli/package.json            ./packages/cli/
COPY packages/design-tokens/package.json  ./packages/design-tokens/
COPY packages/mcp-server/package.json     ./packages/mcp-server/
COPY packages/platform/package.json       ./packages/platform/
COPY packages/policy-schema/package.json  ./packages/policy-schema/
COPY packages/sdk/package.json            ./packages/sdk/
COPY packages/ui/package.json             ./packages/ui/

RUN pnpm install --frozen-lockfile --ignore-scripts --filter spctre

# ── Stage 3: runner ───────────────────────────────────────────────────────────
FROM node:26-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY db/ ./db/

CMD ["node_modules/.bin/tsx", "db/migrate.ts"]
