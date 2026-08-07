# syntax=docker/dockerfile:1

FROM rust:1.95-alpine AS policy-kernel-builder
WORKDIR /src/packages/policy-schema/native

COPY packages/policy-schema/native/Cargo.toml packages/policy-schema/native/Cargo.lock packages/policy-schema/native/build.rs ./
COPY packages/policy-schema/native/src ./src
RUN cargo build --release

FROM golang:1.26.3-alpine AS builder
WORKDIR /src/apps/worker

RUN apk add --no-cache build-base

COPY apps/worker/go.mod apps/worker/go.sum* ./
RUN go mod download

COPY apps/worker/cmd ./cmd
COPY apps/worker/internal ./internal
COPY packages/policy-schema/native/include /src/packages/policy-schema/native/include
COPY --from=policy-kernel-builder /src/packages/policy-schema/native/target/release/libspctre_policy_core.a /src/packages/policy-schema/native/target/release/libspctre_policy_core.a
RUN CGO_ENABLED=1 go build -tags spctre_policy_kernel -trimpath -ldflags="-s -w" -o /out/spctre-worker ./cmd/worker

FROM alpine:3.21 AS runner
WORKDIR /app

RUN addgroup -S worker && adduser -S worker -G worker

COPY --from=builder --chown=worker:worker /out/spctre-worker ./spctre-worker

USER worker

EXPOSE 18080
ENV WORKER_HTTP_PORT=18080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:18080/health || exit 1

CMD ["./spctre-worker"]
