import {
  buildGovernanceSdkRuntimePolicyConfig,
  buildGenkitRuntimePolicyConfig,
  buildMastraRuntimePolicyConfig,
  buildVercelAiRuntimePolicyConfig,
  evaluateConnectorPayloadGuardrail,
} from "./schema";
import type { AgtCompatiblePolicyBundle } from "./types";

export type TypeScriptRuntimeTarget = "mastra" | "vercel-ai" | "genkit" | "governance-sdk";

export interface RuntimeToolCall {
  connector: string;
  action: string;
  domains?: string[];
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
}

/**
 * Dependency-free middleware contract used directly at each supported
 * TypeScript runtime's pre-tool boundary.  It intentionally exposes the
 * reviewed bundle provenance on every evaluation and retains only a payload
 * hash, never the tool payload itself.
 */
export interface SpctreRuntimeMiddleware {
  target: TypeScriptRuntimeTarget;
  provenance: { branchId: string; revisionId: string; artifactHash: string; sourceHash: string };
  evaluate(call: RuntimeToolCall): ReturnType<typeof evaluateConnectorPayloadGuardrail>;
}

export class SpctreToolDeniedError extends Error {
  readonly result: ReturnType<SpctreRuntimeMiddleware["evaluate"]>;
  constructor(result: ReturnType<SpctreRuntimeMiddleware["evaluate"]>) {
    super(result.reason);
    this.name = "SpctreToolDeniedError";
    this.result = result;
  }
}

function denyOrProceed(middleware: SpctreRuntimeMiddleware, call: RuntimeToolCall) {
  const result = middleware.evaluate(call);
  if (result.status === "DENY") throw new SpctreToolDeniedError(result);
  return result;
}

/**
 * Attach directly as Mastra Agent/Workspace `hooks.beforeToolCall` (Mastra
 * 1.49+). A caller supplies schema-valid output for a blocked invocation.
 */
export function createMastraBeforeToolCallHook<TOutput>(params: {
  middleware: SpctreRuntimeMiddleware;
  connector: string;
  denyOutput: (result: ReturnType<SpctreRuntimeMiddleware["evaluate"]>) => TOutput;
}) {
  return ({ toolName, input }: { toolName: string; input: Record<string, unknown> }) => {
    const result = params.middleware.evaluate({
      connector: params.connector,
      action: toolName,
      toolIntent: toolName,
      toolParameters: input,
    });
    return result.status === "DENY"
      ? { proceed: false as const, output: params.denyOutput(result) }
      : undefined;
  };
}

/** Wrap a Vercel AI SDK tool's documented `execute(input, options)` function. */
export function wrapVercelAiToolExecute<TInput extends Record<string, unknown>, TResult>(params: {
  middleware: SpctreRuntimeMiddleware;
  connector: string;
  toolName: string;
  execute: (input: TInput, options: unknown) => TResult | Promise<TResult>;
}) {
  return async (input: TInput, options: unknown): Promise<TResult> => {
    denyOrProceed(params.middleware, {
      connector: params.connector,
      action: params.toolName,
      toolIntent: params.toolName,
      toolParameters: input,
    });
    return params.execute(input, options);
  };
}

/** Wrap a Genkit `defineTool` implementation before it reaches the tool body. */
export function wrapGenkitToolExecute<TInput extends Record<string, unknown>, TResult>(params: {
  middleware: SpctreRuntimeMiddleware;
  connector: string;
  toolName: string;
  execute: (input: TInput, context: unknown) => TResult | Promise<TResult>;
}) {
  return async (input: TInput, context: unknown): Promise<TResult> => {
    denyOrProceed(params.middleware, {
      connector: params.connector,
      action: params.toolName,
      toolIntent: params.toolName,
      toolParameters: input,
    });
    return params.execute(input, context);
  };
}

/** Wrap a governance-sdk governed-tool executor. */
export function wrapGovernanceSdkToolExecute<
  TInput extends Record<string, unknown>,
  TResult,
>(params: {
  middleware: SpctreRuntimeMiddleware;
  connector: string;
  toolName: string;
  execute: (input: TInput, context: unknown) => TResult | Promise<TResult>;
}) {
  return async (input: TInput, context: unknown): Promise<TResult> => {
    denyOrProceed(params.middleware, {
      connector: params.connector,
      action: params.toolName,
      toolIntent: params.toolName,
      toolParameters: input,
    });
    return params.execute(input, context);
  };
}

/**
 * Convert a middleware result into the bounded fields accepted by gateway-mode
 * evidence ingest. Callers merge this with their runtime target/environment;
 * only the payload hash is carried forward.
 */
export function buildGatewayPayloadEvidence(params: {
  middleware: SpctreRuntimeMiddleware;
  decisionId: string;
  call: RuntimeToolCall;
}) {
  const result = params.middleware.evaluate(params.call);
  return {
    decisionId: params.decisionId,
    connector: params.call.connector,
    action: params.call.action,
    status: result.status,
    reason: result.reason,
    policyRefs: result.matchedPolicyRefs,
    artifactHash: params.middleware.provenance.artifactHash,
    policyContext: [
      {
        branchId: params.middleware.provenance.branchId,
        revisionId: params.middleware.provenance.revisionId,
        artifactHash: params.middleware.provenance.artifactHash,
      },
    ],
    ingestMode: "gateway" as const,
    rawEvidence: { _source: "gateway", _payload_guardrail: true, payloadHash: result.payloadHash },
  };
}

function createRuntimeMiddleware(
  bundle: AgtCompatiblePolicyBundle,
  target: TypeScriptRuntimeTarget,
): SpctreRuntimeMiddleware {
  const compiled = {
    mastra: buildMastraRuntimePolicyConfig,
    "vercel-ai": buildVercelAiRuntimePolicyConfig,
    genkit: buildGenkitRuntimePolicyConfig,
    "governance-sdk": buildGovernanceSdkRuntimePolicyConfig,
  }[target](bundle);
  if (!compiled.ok || !compiled.artifact) {
    throw new Error(
      `Cannot install ${target} middleware: reviewed policy export has blocking warnings.`,
    );
  }
  return {
    target,
    provenance: compiled.artifact.provenance,
    evaluate: (call) => evaluateConnectorPayloadGuardrail({ ...call, rules: bundle.rules }),
  };
}

/** Install at Mastra's tool middleware/pre-execution boundary. */
export const createMastraMiddleware = (bundle: AgtCompatiblePolicyBundle) =>
  createRuntimeMiddleware(bundle, "mastra");
/** Install before `execute` in a Vercel AI SDK tool. */
export const createVercelAiMiddleware = (bundle: AgtCompatiblePolicyBundle) =>
  createRuntimeMiddleware(bundle, "vercel-ai");
/** Install in a Genkit action/tool interceptor. */
export const createGenkitMiddleware = (bundle: AgtCompatiblePolicyBundle) =>
  createRuntimeMiddleware(bundle, "genkit");
/** Install in governance-sdk's governed-tool middleware. */
export const createGovernanceSdkMiddleware = (bundle: AgtCompatiblePolicyBundle) =>
  createRuntimeMiddleware(bundle, "governance-sdk");
