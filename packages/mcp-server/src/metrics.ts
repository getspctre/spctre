import { incrementCounter, logger, recordDuration } from "./observability.js";
import type { TransportMode } from "./config.js";

// Per-tool rolling SLO metrics for the MCP server. Extracted from index.ts
// (maintainability audit Hotspot 1). The window state is process-local; values
// are emitted via structured logs and OTEL counters for aggregation.

// SLO thresholds derived from Phase 4 latency baselines (p95/p99 + headroom).
const SLO_P95_MS = 100;
const SLO_P99_MS = 250;
const SLO_ERROR_RATE_WINDOW = 100; // rolling window of last N calls per tool
const SLO_ERROR_RATE_THRESHOLD = 0.05; // 5% error rate triggers alert

interface ToolWindow {
  latencies: number[];
  errors: number;
  calls: number;
}

const toolWindows = new Map<string, ToolWindow>();

export function recordToolMetric(
  tool: string,
  latencyMs: number,
  isError: boolean,
  transport: TransportMode,
): void {
  if (!toolWindows.has(tool)) {
    toolWindows.set(tool, { latencies: [], errors: 0, calls: 0 });
  }
  const w = toolWindows.get(tool)!;
  w.calls++;
  if (isError) w.errors++;
  w.latencies.push(latencyMs);
  if (w.latencies.length > SLO_ERROR_RATE_WINDOW) w.latencies.shift();

  // Compute approximate p95/p99 from the rolling window.
  const sorted = [...w.latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? latencyMs;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? latencyMs;
  const errorRate = w.calls > 0 ? w.errors / Math.min(w.calls, SLO_ERROR_RATE_WINDOW) : 0;

  incrementCounter("spctre.mcp.tool.calls", 1, {
    tool,
    transport,
    outcome: isError ? "error" : "success",
  });
  if (isError) incrementCounter("spctre.mcp.tool.errors", 1, { tool, transport });
  recordDuration("spctre.mcp.tool.duration", latencyMs, {
    tool,
    transport,
    outcome: isError ? "error" : "success",
  });

  logger.info("MCP tool call", {
    event: "mcp.tool_call",
    tool,
    transport,
    latency_ms: latencyMs,
    is_error: isError,
    rolling_p95_ms: p95,
    rolling_p99_ms: p99,
    rolling_error_rate: errorRate,
    session_calls: w.calls,
  });

  if (p95 > SLO_P95_MS) {
    logger.warn("MCP SLO violation", {
      event: "mcp.slo_violation",
      threshold: "p95",
      tool,
      transport,
      value_ms: p95,
      limit_ms: SLO_P95_MS,
    });
  }
  if (p99 > SLO_P99_MS) {
    logger.warn("MCP SLO violation", {
      event: "mcp.slo_violation",
      threshold: "p99",
      tool,
      transport,
      value_ms: p99,
      limit_ms: SLO_P99_MS,
    });
  }
  if (errorRate > SLO_ERROR_RATE_THRESHOLD) {
    logger.warn("MCP SLO violation", {
      event: "mcp.slo_violation",
      threshold: "error_rate",
      tool,
      transport,
      value: errorRate,
      limit: SLO_ERROR_RATE_THRESHOLD,
    });
  }
}

// buildToolMetricsSnapshot returns the per-tool rolling metrics for the
// /metricsz endpoint. The caller layers transport-level fields on top.
export function buildToolMetricsSnapshot(): Record<string, unknown> {
  const metrics: Record<string, unknown> = {};
  for (const [tool, w] of toolWindows) {
    const sorted = [...w.latencies].sort((a, b) => a - b);
    metrics[tool] = {
      calls: w.calls,
      errors: w.errors,
      error_rate: w.calls > 0 ? w.errors / Math.min(w.calls, SLO_ERROR_RATE_WINDOW) : 0,
      p95_ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      p99_ms: sorted[Math.floor(sorted.length * 0.99)] ?? null,
      slo: {
        p95_limit_ms: SLO_P95_MS,
        p99_limit_ms: SLO_P99_MS,
        error_rate_limit: SLO_ERROR_RATE_THRESHOLD,
      },
    };
  }
  return metrics;
}
