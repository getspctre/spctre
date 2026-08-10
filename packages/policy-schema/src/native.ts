// Lazy, optional loader for the Rust policy-core native addon.
//
// The native functions below (gateway/policy evaluation and operations-log
// integrity) are backed by a prebuilt Rust addon. Loading is deferred until the
// first native call so that the pure-TypeScript surface of this package —
// types, packs, import/export, composition, review/publish helpers — imports
// cleanly on every platform, including installs where no prebuilt binary is
// available for the host. Only code paths that actually evaluate policy or hash
// operations-log entries require the addon.
//
// Resolution order:
//   1. SPCTRE_NATIVE_PATH — an absolute path set by apps/web/next.config.mjs so
//      the addon resolves correctly from bundled SSR chunks. Turbopack inlines
//      the value at build time.
//   2. ../native — the packaged, platform-aware loader (native/index.js), which
//      selects the correct prebuilt binary for the host platform and arch.

type NativeBinding = {
  jsEvaluateGatewayDecision(inputJson: string): string;
  jsEvaluatePolicyDecision(inputJson: string): string;
  jsBuildOperationsContentHash(inputJson: string): string;
  jsValidateOperationsLogChain(entriesJson: string): string;
  jsComposePolicyLayers(inputJson: string): string;
  jsValidatePolicyBundle(inputJson: string): string;
  jsPolicyKernelLimits(): string;
};

let binding: NativeBinding | undefined;
let loadFailure: Error | undefined;

function unavailable(cause: Error): Error {
  return new Error(
    "@spctre/policy-schema: the native policy-core addon could not be loaded. " +
      "Native policy/gateway evaluation and operations-log integrity require a " +
      "prebuilt binary for this platform (supported: darwin-arm64, darwin-x64, " +
      "linux-x64-gnu, linux-arm64-gnu). Reinstall on a supported platform, or " +
      "build it from source with " +
      "`pnpm --filter @spctre/policy-schema build:native`.\n" +
      `Underlying error: ${cause.message}`,
    { cause },
  );
}

function load(): NativeBinding {
  if (binding) return binding;
  if (loadFailure) throw unavailable(loadFailure);
  const target = process.env.SPCTRE_NATIVE_PATH ?? "../native";
  try {
    binding = require(/* webpackIgnore: true */ target) as NativeBinding;
    return binding;
  } catch (err) {
    loadFailure = err as Error;
    throw unavailable(loadFailure);
  }
}

export function jsEvaluateGatewayDecision(inputJson: string): string {
  return load().jsEvaluateGatewayDecision(inputJson);
}

export function jsEvaluatePolicyDecision(inputJson: string): string {
  return load().jsEvaluatePolicyDecision(inputJson);
}

export function jsBuildOperationsContentHash(inputJson: string): string {
  return load().jsBuildOperationsContentHash(inputJson);
}

export function jsValidateOperationsLogChain(entriesJson: string): string {
  return load().jsValidateOperationsLogChain(entriesJson);
}

export function jsComposePolicyLayers(inputJson: string): string {
  return load().jsComposePolicyLayers(inputJson);
}

export function jsValidatePolicyBundle(inputJson: string): string {
  return load().jsValidatePolicyBundle(inputJson);
}

export function jsPolicyKernelLimits(): string {
  return load().jsPolicyKernelLimits();
}
