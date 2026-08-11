export interface SloThresholds {
  p95Ms: number;
  p99Ms: number;
  errorRateThreshold: number;
  slowQueryThresholdMs: number;
}

export const SLO_THRESHOLDS: Record<string, SloThresholds> = {
  "evidence.ingest": {
    p95Ms: 500,
    p99Ms: 1_000,
    errorRateThreshold: 0.01,
    slowQueryThresholdMs: 100,
  },
  "token.refresh": { p95Ms: 100, p99Ms: 250, errorRateThreshold: 0.01, slowQueryThresholdMs: 50 },
  "policy.import": {
    p95Ms: 2_000,
    p99Ms: 5_000,
    errorRateThreshold: 0.02,
    slowQueryThresholdMs: 200,
  },
  "policy.review": {
    p95Ms: 1_000,
    p99Ms: 3_000,
    errorRateThreshold: 0.02,
    slowQueryThresholdMs: 150,
  },
  "policy.publish": {
    p95Ms: 2_000,
    p99Ms: 5_000,
    errorRateThreshold: 0.01,
    slowQueryThresholdMs: 200,
  },
  /**
   * Bound to the customer-facing availability contract (p95 < 150 ms,
   * p99 < 300 ms for Cloud gateway decisions). Internal alerting must not be
   * looser than the published commitment, or a contract breach can burn
   * without firing. Changing these numbers changes a customer promise: update
   * the availability contract and the observability reference together.
   */
  "gateway.decide": { p95Ms: 150, p99Ms: 300, errorRateThreshold: 0.01, slowQueryThresholdMs: 100 },
  "gateway.resolve": {
    p95Ms: 500,
    p99Ms: 1_000,
    errorRateThreshold: 0.02,
    slowQueryThresholdMs: 100,
  },
  "mcp.tool": { p95Ms: 100, p99Ms: 250, errorRateThreshold: 0.05, slowQueryThresholdMs: 100 },
  "worker.retention": {
    p95Ms: 30_000,
    p99Ms: 60_000,
    errorRateThreshold: 0.05,
    slowQueryThresholdMs: 500,
  },
  "worker.verification_sweep": {
    p95Ms: 10_000,
    p99Ms: 30_000,
    errorRateThreshold: 0.05,
    slowQueryThresholdMs: 500,
  },
};

export const SLOW_QUERY_THRESHOLD_MS = 100;
export const DB_POOL_SATURATION_WARN_RATIO = 0.8;
export const INGEST_LAG_WARN_MS = 60_000;

export function isSloViolation(
  workflow: string,
  durationMs: number,
  percentile: "p95" | "p99",
): boolean {
  const thresholds = SLO_THRESHOLDS[workflow];
  if (!thresholds) return false;
  return percentile === "p95" ? durationMs > thresholds.p95Ms : durationMs > thresholds.p99Ms;
}
