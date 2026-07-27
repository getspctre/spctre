import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type ObservableGauge,
} from "@opentelemetry/api";
import { DB_POOL_SATURATION_WARN_RATIO, SLOW_QUERY_THRESHOLD_MS } from "./slos.js";
import { currentServiceName } from "./observability-state.js";
import { redactAttributes, writeLog } from "./logging.js";

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
// One ObservableGauge + callback per metric name (not per name+attrs), plus the
// current value for each attribute-set under that name. See setGauge.
const gaugeInstruments = new Map<string, ObservableGauge>();
const gaugeSeries = new Map<string, Map<string, { value: number; attrs: Attributes }>>();
const observableGauges = new Map<string, ObservableGauge>();

export function recordDuration(name: string, valueMs: number, attrs: Record<string, unknown> = {}): void {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = metrics.getMeter(currentServiceName()).createHistogram(name, { unit: "ms" });
    histograms.set(name, histogram);
  }
  histogram.record(valueMs, redactAttributes(attrs));
}

export function incrementCounter(name: string, value = 1, attrs: Record<string, unknown> = {}): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = metrics.getMeter(currentServiceName()).createCounter(name);
    counters.set(name, counter);
  }
  counter.add(value, redactAttributes(attrs));
}

// setGauge records the latest value for a gauge metric. Attributes are expected
// to be low-cardinality: a single ObservableGauge + callback is created per
// metric `name` (never per name+attrs), and that one callback observes every
// attribute-set currently recorded under the name. This bounds instruments and
// callbacks to one-per-name regardless of attribute cardinality; the per-attrs
// value map still grows with distinct attribute-sets, so callers must not pass
// unbounded (e.g. per-tenant/per-request) attribute values.
export function setGauge(name: string, value: number, attrs: Record<string, unknown> = {}): void {
  const safeAttrs = redactAttributes(attrs);
  const attrKey = JSON.stringify(safeAttrs);

  let series = gaugeSeries.get(name);
  if (!series) {
    series = new Map();
    gaugeSeries.set(name, series);
  }
  series.set(attrKey, { value, attrs: safeAttrs });

  if (!gaugeInstruments.has(name)) {
    const instrument = metrics.getMeter(currentServiceName()).createObservableGauge(name);
    instrument.addCallback((result) => {
      const current = gaugeSeries.get(name);
      if (!current) return;
      for (const entry of current.values()) {
        result.observe(entry.value, entry.attrs);
      }
    });
    gaugeInstruments.set(name, instrument);
  }
}

export interface DbPoolStats {
  active: number;
  idle: number;
  waiting: number;
  max: number;
}

export function registerDbPoolMetrics(name: string, statsFn: () => DbPoolStats): void {
  const meter = metrics.getMeter(currentServiceName());

  function getOrCreate(metricName: string): ObservableGauge {
    if (!observableGauges.has(metricName)) {
      observableGauges.set(metricName, meter.createObservableGauge(metricName));
    }
    return observableGauges.get(metricName)!;
  }

  getOrCreate("spctre.db.pool.active").addCallback((result) => {
    result.observe(statsFn().active, { "db.pool.name": name });
  });
  getOrCreate("spctre.db.pool.idle").addCallback((result) => {
    result.observe(statsFn().idle, { "db.pool.name": name });
  });
  getOrCreate("spctre.db.pool.waiting").addCallback((result) => {
    result.observe(statsFn().waiting, { "db.pool.name": name });
  });
  getOrCreate("spctre.db.pool.saturation").addCallback((result) => {
    const { active, max } = statsFn();
    const ratio = max > 0 ? active / max : 0;
    result.observe(ratio, { "db.pool.name": name });
    if (ratio >= DB_POOL_SATURATION_WARN_RATIO) {
      writeLog("warn", "DB pool saturation above threshold", { "db.pool.name": name, saturation: ratio });
    }
  });
}

export function recordQueryDuration(
  queryName: string,
  durationMs: number,
  attrs: Record<string, unknown> = {},
): void {
  recordDuration("spctre.db.query.duration", durationMs, { "db.query.name": queryName, ...attrs });
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    writeLog("warn", "Slow query detected", {
      "db.query.name": queryName,
      "db.query.duration_ms": durationMs,
      slow_query_threshold_ms: SLOW_QUERY_THRESHOLD_MS,
      ...attrs,
    });
    incrementCounter("spctre.db.slow_queries", 1, { "db.query.name": queryName });
  }
}
