use napi_derive::napi;

use crate::eval::{evaluate_gateway_decision, evaluate_policy_decision};
use crate::integrity::{build_operations_content_hash, validate_operations_log_chain};
use crate::types::*;

// ── napi bindings ──────────────────────────────────────────────────────────────
// Each function accepts and returns JSON strings so complex types (serde_json::Value
// payloads) cross the boundary without needing napi object representations.

#[napi]
pub fn js_evaluate_gateway_decision(input_json: String) -> napi::Result<String> {
    let input: GatewayDecisionInput =
        serde_json::from_str(&input_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let result = evaluate_gateway_decision(input);
    serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn js_evaluate_policy_decision(input_json: String) -> napi::Result<String> {
    let input: PolicyEvaluationInput =
        serde_json::from_str(&input_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let result = evaluate_policy_decision(input);
    serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn js_build_operations_content_hash(input_json: String) -> napi::Result<String> {
    let input: OperationsLogHashInput =
        serde_json::from_str(&input_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(build_operations_content_hash(&input))
}

#[napi]
pub fn js_validate_operations_log_chain(entries_json: String) -> napi::Result<String> {
    let entries: Vec<OperationsLogChainEntry> =
        serde_json::from_str(&entries_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let issues = validate_operations_log_chain(&entries);
    serde_json::to_string(&issues).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn napi_gateway_roundtrip() {
        let result_json =
            js_evaluate_gateway_decision(r#"{"consequence":"IRREVERSIBLE"}"#.to_string()).unwrap();
        let result: GatewayDecisionResult = serde_json::from_str(&result_json).unwrap();
        assert_eq!(result.outcome, GatewayOutcome::Abort);
    }

    #[test]
    fn napi_hash_roundtrip() {
        let hash = js_build_operations_content_hash(
            r#"{"eventType":"EVIDENCE_INGEST","sourceId":"ev-42","sourceTable":"runtime_evidence_event","actorId":"svc-1","payload":{"status":"ALLOW","nested":{"b":2,"a":1}},"prevHash":"sha256:previous"}"#.to_string(),
        )
        .unwrap();
        assert_eq!(
            hash,
            "sha256:a19a83ee12d8df3f1fc7b5228b17278a63b03eade7a2a216ecdb7681f44bf9ad"
        );
    }
}
