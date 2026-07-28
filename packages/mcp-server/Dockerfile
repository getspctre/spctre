# syntax=docker/dockerfile:1

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:25-alpine AS base
RUN if command -v corepack >/dev/null 2>&1; then \
      corepack enable && corepack prepare pnpm@11.1.1 --activate; \
    else \
      npm install -g pnpm@11.1.1; \
    fi

# ── Stage 2: install dependencies ─────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN pnpm install --frozen-lockfile --ignore-scripts --filter @spctre/mcp-server...

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app ./
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/mcp-server ./packages/mcp-server

RUN cd packages/mcp-server && rm -rf dist && node_modules/.bin/tsc

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:25-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcpserver

# Compiled MCP server output and package manifest.
COPY --from=builder --chown=mcpserver:nodejs /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder --chown=mcpserver:nodejs /app/packages/mcp-server/package.json ./packages/mcp-server/package.json

# Root node_modules (pnpm virtual store + dep symlinks) from the deps stage.
COPY --from=deps --chown=mcpserver:nodejs /app/node_modules ./node_modules

# Package-level node_modules holds scoped symlinks used by runtime resolution.
COPY --from=deps --chown=mcpserver:nodejs /app/packages/mcp-server/node_modules ./packages/mcp-server/node_modules

USER mcpserver

WORKDIR /app/packages/mcp-server

# HTTP/SSE transport port (STDIO mode exposes no port)
EXPOSE 3100

ENV SPCTRE_MCP_TRANSPORT=http
ENV SPCTRE_MCP_HTTP_PORT=3100

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/healthz || exit 1

CMD ["node", "dist/index.js"]
