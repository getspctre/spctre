// Runtime validation of MCP tool arguments against the JSON Schemas advertised
// in `schemas.ts`. This is the real check behind the typed handler args: the
// MCP transport delivers arguments as untyped `Record<string, unknown>`, and
// the SDK does not validate them against a tool's `inputSchema`. Compiling the
// same schemas we advertise keeps a single source of truth — the contract a
// client reads from ListTools is exactly the contract enforced on CallTool.

import Ajv, { type ValidateFunction } from "ajv";
import { TOOL_SCHEMAS } from "./schemas.js";

// strict: false so advertised-but-non-validating annotations (e.g. `default`,
// `description`) don't fail schema compilation. allErrors surfaces every
// problem in one message instead of stopping at the first.
const ajv = new Ajv({ strict: false, allErrors: true });

const validators = new Map<string, ValidateFunction>();
for (const tool of TOOL_SCHEMAS) {
  validators.set(tool.name, ajv.compile(tool.inputSchema));
}

export class McpToolValidationError extends Error {
  constructor(toolName: string, detail: string) {
    super(`Invalid arguments for ${toolName}: ${detail}`);
    this.name = "McpToolValidationError";
  }
}

// Validate raw tool args against the tool's advertised schema and return them
// typed as T. Throws McpToolValidationError on any violation. Unlike a bare
// cast, the returned value is guaranteed to satisfy the advertised contract
// (required fields present, enums/types honored). Tools without an advertised
// schema pass through unchecked.
export function validateToolArgs<T>(
  toolName: string,
  args: Record<string, unknown> | undefined,
): T {
  const validate = validators.get(toolName);
  const candidate = args ?? {};
  if (!validate) {
    return candidate as unknown as T;
  }
  if (!validate(candidate)) {
    const detail =
      (validate.errors ?? [])
        .map((e) => `${e.instancePath || "(root)"} ${e.message}`.trim())
        .join("; ") || "does not match the advertised schema";
    throw new McpToolValidationError(toolName, detail);
  }
  return candidate as unknown as T;
}
