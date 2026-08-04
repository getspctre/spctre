import { trace, type Attributes, type AttributeValue } from "@opentelemetry/api";
import { currentServiceName } from "./observability-state.js";

type LogLevel = "info" | "warn" | "error";

export type TelemetryAttributes = Attributes;

// Broad substrings are safe to match anywhere in a key. `ssn` and `card` are
// too short for that (they'd redact "cardinality"/"discarded"), so they are
// matched as whole words after splitting the key on camelCase and
// non-alphanumeric boundaries — `userSsn`, `cardCvc`, and `card_last4` are
// redacted while `cardinality` and `discarded` pass through. All-lowercase
// concatenations have no word boundary, so the common ones stay in the
// substring list (`creditcard`, `cardnumber`, `cardholder`).
const SENSITIVE_KEY_SUBSTRINGS =
  /token|secret|password|authorization|cookie|raw.?evidence|principal.?id|access.?key|refresh.?key|e.?mail|phone|credit.?card|card.?(?:number|holder)/i;
const SENSITIVE_KEY_WORDS = /^(?:ssn|card)$/i;
const KEY_WORD_BOUNDARY = /[^a-zA-Z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEY_SUBSTRINGS.test(key)) return true;
  return key.split(KEY_WORD_BOUNDARY).some((word) => SENSITIVE_KEY_WORDS.test(word));
}

const MAX_ATTRIBUTE_LENGTH = 300;
const MAX_REDACTION_DEPTH = 8;

function normalizeAttributeValue(
  value: unknown,
): string | number | boolean | string[] | number[] | boolean[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string")
    return value.length > MAX_ATTRIBUTE_LENGTH
      ? `${value.slice(0, MAX_ATTRIBUTE_LENGTH)}...`
      : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeAttributeValue(item))
      .filter((item): item is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof item),
      );
    if (normalized.every((item) => typeof item === "string")) return normalized as string[];
    if (normalized.every((item) => typeof item === "number")) return normalized as number[];
    if (normalized.every((item) => typeof item === "boolean")) return normalized as boolean[];
    return normalized.map(String);
  }
  return JSON.stringify(value).slice(0, MAX_ATTRIBUTE_LENGTH);
}

function safeStringify(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[Unserializable]";
  }
}

function sanitizeForLog(
  value: unknown,
  key = "",
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (key && isSensitiveKey(key)) return "[REDACTED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return "[MaxDepth]";

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, "", depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[childKey] = sanitizeForLog(childValue, childKey, depth + 1, seen);
  }
  return sanitized;
}

export function redactAttributes(attrs: Record<string, unknown> = {}): Attributes {
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isSensitiveKey(key)) {
      safe[key] = "[REDACTED]";
      continue;
    }
    const sanitized = sanitizeForLog(value, key);
    const normalized = normalizeAttributeValue(sanitized);
    if (normalized !== undefined) safe[key] = normalized;
  }
  return safe;
}

function logFields(attrs: Record<string, unknown> = {}): Record<string, AttributeValue> {
  const safe: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const sanitized = sanitizeForLog(value, key);
    const normalized = normalizeAttributeValue(sanitized);
    if (normalized !== undefined) safe[key] = normalized;
  }
  return safe;
}

function activeTraceFields(): Record<string, string> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) return {};
  const fields: Record<string, string> = {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
  const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (projectId) {
    fields["logging.googleapis.com/trace"] = `projects/${projectId}/traces/${spanContext.traceId}`;
    fields["logging.googleapis.com/spanId"] = spanContext.spanId;
  }
  return fields;
}

export function writeLog(
  level: LogLevel,
  message: string,
  attrs: Record<string, unknown> = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    "service.name": currentServiceName(),
    ...activeTraceFields(),
    ...logFields(attrs),
  };
  const line = safeStringify(payload);
  // A stdio MCP server reserves stdout exclusively for protocol frames. Let
  // such entry points opt into stderr for their informational logs too.
  const logToStderr = process.env.SPCTRE_LOG_STDERR?.trim().toLowerCase() === "true";
  if (level === "error" || logToStderr) console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, attrs?: Record<string, unknown>) => writeLog("info", message, attrs),
  warn: (message: string, attrs?: Record<string, unknown>) => writeLog("warn", message, attrs),
  error: (message: string, attrs?: Record<string, unknown>) => writeLog("error", message, attrs),
};
