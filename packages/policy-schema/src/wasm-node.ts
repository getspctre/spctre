// Node-side convenience over the portable kernel.
//
// Kept apart from ./wasm so that module stays runtime-agnostic: importing this
// file is what pulls in node:fs, and a browser or edge host imports ./wasm and
// supplies its own bytes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPortablePolicyKernel, type PortablePolicyKernel } from "./wasm";

/**
 * Path to the packaged module, for hosts that want to load the bytes themselves.
 *
 * Resolved from __dirname rather than import.meta.url because this package is
 * built to CommonJS; the compiled file sits in dist/, one level below native/.
 */
export function portablePolicyKernelPath(): string {
  return join(__dirname, "..", "native", "spctre_policy_core.wasm");
}

let cached: Promise<PortablePolicyKernel> | undefined;

/**
 * Loads the packaged kernel once per process.
 *
 * Instantiation is cached rather than repeated: the module is stateless between
 * calls, and re-instantiating per decision would dominate the cost of the
 * decision itself in a short-lived CLI process.
 */
export function loadPortablePolicyKernel(): Promise<PortablePolicyKernel> {
  cached ??= createPortablePolicyKernel(readFileSync(portablePolicyKernelPath()));
  return cached;
}
