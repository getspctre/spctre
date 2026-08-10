// Portable delivery of the policy kernel for hosts that cannot load a native
// addon: the CLI on an unsupported platform, offline and air-gapped runtimes,
// edge workers, browsers.
//
// This binds the same bounded JSON C ABI the Go worker links, so a portable host
// runs the one kernel rather than a reimplementation of it. There is deliberately
// no wasm-bindgen or generated glue: the module exports plain C functions over
// linear memory, so it instantiates with no imports and this file needs no
// dependencies.
//
// The kernel is authoritative but not omniscient — it evaluates the policy it is
// given. A host that cannot obtain current published policy is offline in the
// governance sense, whatever this module returns.

import type { EvaluationResult, PolicyRuleSummary } from "./types";

const STATUS_NAMES: Record<number, string> = {
  1: "invalid request",
  2: "resource limit exceeded",
  3: "serialization error",
  4: "contained kernel panic",
};

type KernelExports = {
  memory: WebAssembly.Memory;
  spctre_policy_buffer_alloc(len: number): number;
  spctre_policy_buffer_free(ptr: number, len: number): void;
  spctre_policy_evaluate(
    requestPtr: number,
    requestLen: number,
    outPtr: number,
    outLenPtr: number,
  ): number;
  spctre_policy_compose_layers(
    requestPtr: number,
    requestLen: number,
    outPtr: number,
    outLenPtr: number,
  ): number;
  spctre_policy_validate_bundle(
    requestPtr: number,
    requestLen: number,
    outPtr: number,
    outLenPtr: number,
  ): number;
};

type AbiEntryPoint =
  "spctre_policy_evaluate" | "spctre_policy_compose_layers" | "spctre_policy_validate_bundle";

/** Size of the two out-parameter slots (`uint8_t*` and `size_t` on wasm32). */
const OUT_PARAMS_BYTES = 8;

export class PolicyKernelAbiError extends Error {
  constructor(
    readonly status: number,
    entryPoint: string,
  ) {
    super(
      `${entryPoint} failed with status ${status} (${STATUS_NAMES[status] ?? "unknown status"}). ` +
        "Callers must fail closed on any nonzero status.",
    );
    this.name = "PolicyKernelAbiError";
  }
}

export type PortablePolicyKernel = {
  evaluatePolicyDecision(input: Record<string, unknown>): EvaluationResult;
  composePolicyLayers(layers: { scope: string; rules: PolicyRuleSummary[] }[]): {
    effective: { layerIndex: number; ruleIndex: number; stableRuleId: string; scope: string }[];
    conflictNotes: string[];
  };
  validatePolicyBundle(request: {
    rules?: PolicyRuleSummary[];
    layers?: { scope: string; rules: PolicyRuleSummary[] }[];
  }): { valid: boolean; issues: { severity: string; code: string; message: string }[] };
};

/**
 * Instantiates the portable kernel from raw module bytes.
 *
 * Bytes are passed in rather than read here so this works unchanged in Node, a
 * browser, and an edge runtime, none of which agree on how to read a file.
 */
export async function createPortablePolicyKernel(
  moduleBytes: BufferSource | WebAssembly.Module,
): Promise<PortablePolicyKernel> {
  const { instance } =
    moduleBytes instanceof WebAssembly.Module
      ? { instance: await WebAssembly.instantiate(moduleBytes, {}) }
      : await WebAssembly.instantiate(moduleBytes, {});
  const exports = instance.exports as unknown as KernelExports;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Re-read the buffer on every access. Any allocation may grow the module's
  // memory, which detaches every previously created view.
  const bytes = () => new Uint8Array(exports.memory.buffer);
  const view = () => new DataView(exports.memory.buffer);

  function alloc(length: number): number {
    const ptr = exports.spctre_policy_buffer_alloc(length);
    if (ptr === 0) {
      throw new Error(
        `policy kernel refused a ${length}-byte allocation; the request exceeds its bounds.`,
      );
    }
    return ptr;
  }

  function call(entryPoint: AbiEntryPoint, payload: unknown): string {
    const request = encoder.encode(JSON.stringify(payload));
    const requestPtr = alloc(request.length);
    const outParams = alloc(OUT_PARAMS_BYTES);
    let responsePtr = 0;
    let responseLen = 0;
    try {
      bytes().set(request, requestPtr);
      const status = exports[entryPoint](requestPtr, request.length, outParams, outParams + 4);
      if (status !== 0) throw new PolicyKernelAbiError(status, entryPoint);
      responsePtr = view().getUint32(outParams, true);
      responseLen = view().getUint32(outParams + 4, true);
      // Copy out before any further allocation can move the memory.
      return decoder.decode(bytes().slice(responsePtr, responsePtr + responseLen));
    } finally {
      if (responsePtr !== 0) exports.spctre_policy_buffer_free(responsePtr, responseLen);
      exports.spctre_policy_buffer_free(outParams, OUT_PARAMS_BYTES);
      exports.spctre_policy_buffer_free(requestPtr, request.length);
    }
  }

  return {
    evaluatePolicyDecision: (input) =>
      JSON.parse(call("spctre_policy_evaluate", input)) as EvaluationResult,
    composePolicyLayers: (layers) =>
      JSON.parse(
        call("spctre_policy_compose_layers", {
          layers: layers.map((layer) => ({
            scope: layer.scope,
            rules: layer.rules.map((rule) => ({
              stableRuleId: rule.stableRuleId,
              immutable: rule.immutable,
            })),
          })),
        }),
      ) as ReturnType<PortablePolicyKernel["composePolicyLayers"]>,
    validatePolicyBundle: (request) =>
      JSON.parse(call("spctre_policy_validate_bundle", request)) as ReturnType<
        PortablePolicyKernel["validatePolicyBundle"]
      >,
  };
}
