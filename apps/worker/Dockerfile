# syntax=docker/dockerfile:1

FROM golang:1.26.3-alpine AS builder
WORKDIR /src/apps/worker

COPY apps/worker/go.mod apps/worker/go.sum* ./
RUN go mod download

COPY apps/worker/cmd ./cmd
COPY apps/worker/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/spctre-worker ./cmd/worker

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
