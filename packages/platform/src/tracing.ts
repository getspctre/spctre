import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { currentServiceName, DEFAULT_SERVICE_NAME } from "./observability-state.js";
import { incrementCounter, recordDuration } from "./metrics.js";
import { redactAttributes } from "./logging.js";

function tracer(): Tracer {
  return trace.getTracer(currentServiceName() || DEFAULT_SERVICE_NAME);
}

export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown>,
  fn: (span: Span) => Promise<T> | T,
  options?: { autoRecord?: boolean; metricName?: string }
): Promise<T> {
  const span = tracer().startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: redactAttributes(attrs),
  });

  return await context.with(trace.setSpan(context.active(), span), async () => {
    const started = Date.now();
    try {
      const result = await fn(span);
      const status = result instanceof Response ? result.status : undefined;
      if (status !== undefined) {
        span.setAttribute("http.response.status_code", status);
      }
      span.setStatus(
        status !== undefined && status >= 400
          ? { code: SpanStatusCode.ERROR, message: `HTTP ${status}` }
          : { code: SpanStatusCode.OK }
      );
      if (options?.autoRecord) {
        const metric = options.metricName ?? `spctre.${name.replace(/\./g, '_')}.duration`;
        recordDuration(metric, Date.now() - started, { ...attrs });
      }
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      incrementCounter("spctre.span.errors", 1, { "span.name": name, "error.type": err instanceof Error ? err.name : "Error", ...attrs });
      throw err;
    } finally {
      span.end();
    }
  });
}
