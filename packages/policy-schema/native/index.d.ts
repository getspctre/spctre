/**
 * Evaluate a gateway decision. Accepts and returns JSON strings so that
 * serde_json::Value payloads cross the JS/Rust boundary without conversion.
 * Input: JSON-serialised GatewayDecisionInput (camelCase fields).
 * Output: JSON-serialised GatewayDecisionResult (camelCase fields).
 */
export declare function jsEvaluateGatewayDecision(inputJson: string): string

/**
 * Evaluate policy rules against a runtime evidence record.
 * Input: JSON-serialised PolicyEvaluationInput (camelCase fields).
 * Output: JSON-serialised EvaluationResult (camelCase fields).
 */
export declare function jsEvaluatePolicyDecision(inputJson: string): string

/**
 * Build a sha256-prefixed content hash for an operations-log entry.
 * Input: JSON-serialised OperationsLogHashInput (camelCase, payload as object).
 * Output: "sha256:<hex>" string.
 */
export declare function jsBuildOperationsContentHash(inputJson: string): string

/**
 * Validate the hash chain of a sequence of operations-log entries.
 * Input: JSON-serialised OperationsLogChainEntry[] (camelCase fields).
 * Output: JSON-serialised ChainIssue[] (empty array when chain is intact).
 */
export declare function jsValidateOperationsLogChain(entriesJson: string): string
