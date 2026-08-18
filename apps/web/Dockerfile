# syntax=docker/dockerfile:1

# ── Stage 0: Rust native addon (spctre_policy_core) ───────────────────────────
FROM rust:1.95.0 AS rust-builder
ARG TARGETARCH
WORKDIR /build
COPY packages/policy-schema/native/Cargo.toml packages/policy-schema/native/Cargo.lock* ./
COPY packages/policy-schema/native/build.rs ./
COPY packages/policy-schema/native/src ./src
RUN cargo build --release
RUN case "$TARGETARCH" in \
        amd64) cp target/release/libspctre_policy_core.so spctre_policy_core.linux-x64-gnu.node ;; \
        arm64) cp target/release/libspctre_policy_core.so spctre_policy_core.linux-arm64-gnu.node ;; \
        *) echo "Unsupported Docker target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:26-slim AS base
RUN if command -v corepack >/dev/null 2>&1; then \
            corepack enable && corepack prepare pnpm@11.1.1 --activate; \
        else \
            npm install -g pnpm@11.1.1; \
        fi

# ── Stage 2: install dependencies ─────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy workspace manifests and lockfile first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/api-contracts/package.json ./packages/api-contracts/
COPY packages/cli/package.json ./packages/cli/
COPY packages/design-tokens/package.json ./packages/design-tokens/
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/platform/package.json ./packages/platform/
COPY packages/policy-schema/package.json ./packages/policy-schema/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/ui/package.json ./packages/ui/

RUN pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app ./
COPY --from=rust-builder /build/spctre_policy_core.*.node \
     ./packages/policy-schema/native/

COPY . .

# Only policy-schema needs a pre-build step (tsc); the rest are handled by
# Next.js transpilePackages at web build time.
RUN cd packages/policy-schema && node_modules/.bin/tsc -p tsconfig.build.json

ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && node_modules/.bin/next build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV SPCTRE_RUNTIME_MODE=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only the standalone output and static assets.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/policy-schema/native ./packages/policy-schema/native

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
