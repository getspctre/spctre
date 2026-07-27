// SPCTRE_NATIVE_PATH is set in next.config.mjs using the real __dirname (not
// bundled). Turbopack inlines the value at build time, so require() receives an
// absolute path that resolves correctly regardless of where the SSR chunk lives.
const _nativePath = process.env.SPCTRE_NATIVE_PATH ?? /* fallback for direct Node */ "../native";
const { jsEvaluateGatewayDecision, jsEvaluatePolicyDecision, jsBuildOperationsContentHash, jsValidateOperationsLogChain } =
  require(/* webpackIgnore: true */ _nativePath) as {
    jsEvaluateGatewayDecision(inputJson: string): string;
    jsEvaluatePolicyDecision(inputJson: string): string;
    jsBuildOperationsContentHash(inputJson: string): string;
    jsValidateOperationsLogChain(entriesJson: string): string;
  };

export { jsEvaluateGatewayDecision, jsEvaluatePolicyDecision, jsBuildOperationsContentHash, jsValidateOperationsLogChain };
