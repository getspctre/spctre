use napi_derive::napi;

use crate::eval::{compose_layer_selection, evaluate_gateway_decision, evaluate_policy_decision};
use crate::ffi::{MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES};
use crate::integrity::{build_operations_content_hash, validate_operations_log_chain};
use crate::types::*;
use crate::validate::{validate_policy_bundle, PolicyBundleValidationRequest};

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

/// Composes ordered layers, returning winning positions rather than rules so the
/// host keeps its own richer rule objects. See `compose_layer_selection`.
#[napi]
pub fn js_compose_policy_layers(input_json: String) -> napi::Result<String> {
    let request: CompositionRequest =
        serde_json::from_str(&input_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let selection = compose_layer_selection(&request.layers);
    serde_json::to_string(&selection).map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Validates that a bundle can be enforced at all. See the `validate` module for
/// why these checks belong to the kernel rather than the host.
#[napi]
pub fn js_validate_policy_bundle(input_json: String) -> napi::Result<String> {
    let request: PolicyBundleValidationRequest =
        serde_json::from_str(&input_json).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let validation = validate_policy_bundle(&request);
    serde_json::to_string(&validation).map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Reports the kernel's own resource limits so hosts can check a policy against
/// them instead of restating the numbers. A host that hardcodes these drifts
/// silently the moment the kernel changes them.
#[napi]
pub fn js_policy_kernel_limits() -> napi::Result<String> {
    serde_json::to_string(&PolicyKernelLimits {
        max_request_bytes: MAX_REQUEST_BYTES,
        max_response_bytes: MAX_RESPONSE_BYTES,
    })
    .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn napi_limits_report_the_abi_constants() {
        let limits: PolicyKernelLimits =
            serde_json::from_str(&js_policy_kernel_limits().unwrap()).unwrap();
        assert_eq!(limits.max_request_bytes, MAX_REQUEST_BYTES);
        assert_eq!(limits.max_response_bytes, MAX_RESPONSE_BYTES);
    }

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
