const SENSITIVE_KEY_PATTERN = /authorization|token|secret|password|credential|jwt|cookie|ssn|card|cvv|private|cert|ssh|client_id|client_secret|clientsecret|clientid|db_|\bkey\b|^key$|api_?key|apiKey|secret_?key|secretKey|private_?key|privateKey|auth_?key|authKey|access_?key|accessKey|sensitive/i;

export function redactAndBoundParameters(
  params: unknown,
  maxDepth = 4,
  maxNodes = 100
): Record<string, unknown> | undefined {
  if (params === null || params === undefined || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }

  let nodeCount = 0;

  function walk(val: unknown, depth: number): unknown {
    if (nodeCount >= maxNodes) {
      return "[Truncated: Max node limit reached]";
    }
    if (depth > maxDepth) {
      return "[Truncated: Max depth reached]";
    }

    nodeCount++;

    if (val === null || val === undefined) return val;

    if (Array.isArray(val)) {
      return val.map((item) => walk(item, depth + 1));
    }

    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const k of Object.keys(obj)) {
        if (nodeCount >= maxNodes) {
          result[k] = "[Truncated: Max node limit reached]";
          continue;
        }
        if (SENSITIVE_KEY_PATTERN.test(k)) {
          result[k] = "[REDACTED]";
        } else {
          result[k] = walk(obj[k], depth + 1);
        }
      }
      return result;
    }

    if (typeof val === "string") {
      if (val.length > 500) {
        return val.slice(0, 500) + "... [Truncated]";
      }
      // Simple heuristic for secret/key/token patterns in string values
      if (val.startsWith("eyJ") || /^[a-zA-Z0-9_-]{32,512}$/.test(val)) {
        if (/token|secret|key|auth/i.test(val) || val.length > 60) {
          return "[REDACTED (Sensitive Value Heuristic)]";
        }
      }
      return val;
    }

    return val;
  }

  const sanitized = walk(params, 1);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

export function redactAndBoundJson(
  value: unknown,
  maxDepth = 6,
  maxNodes = 250
): unknown {
  let nodeCount = 0;

  function walk(val: unknown, key: string, depth: number): unknown {
    if (nodeCount >= maxNodes) {
      return "[Truncated: Max node limit reached]";
    }
    if (depth > maxDepth) {
      return "[Truncated: Max depth reached]";
    }

    nodeCount++;

    if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
    if (val === null || val === undefined) return val;

    if (Array.isArray(val)) {
      return val.map((item) => walk(item, "", depth + 1));
    }

    if (typeof val === "object") {
      const result: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(val as Record<string, unknown>)) {
        result[childKey] = walk(childValue, childKey, depth + 1);
      }
      return result;
    }

    if (typeof val === "string") {
      if (val.length > 1000) return val.slice(0, 1000) + "... [Truncated]";
      if (val.startsWith("eyJ") || /^[a-zA-Z0-9_-]{32,512}$/.test(val)) {
        if (/token|secret|key|auth/i.test(val) || val.length > 60) {
          return "[REDACTED (Sensitive Value Heuristic)]";
        }
      }
      return val;
    }

    return val;
  }

  return walk(value, "", 1);
}

export function sanitizeText(text: unknown, maxLength: number): string | undefined {
  if (typeof text !== "string") return undefined;
  let val = text.trim();
  if (val.length > maxLength) {
    val = val.slice(0, maxLength) + "... [Truncated]";
  }
  return val;
}
