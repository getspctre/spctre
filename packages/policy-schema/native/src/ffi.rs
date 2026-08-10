//! Stable JSON-bytes C ABI for in-process hosts such as the Go worker.
//!
//! The ABI deliberately exposes no Rust layouts. Callers own no returned
//! allocation: they must release every successful response with
//! `spctre_policy_buffer_free` using the pointer and length returned here.

use std::panic::{self, AssertUnwindSafe};
use std::ptr;

use crate::validate::{validate_policy_bundle, PolicyBundleValidationRequest};
use crate::{
    compose_layer_selection, evaluate_policy_decision, CompositionRequest, PolicyEvaluationInput,
};

pub const SPCTRE_POLICY_OK: i32 = 0;
pub const SPCTRE_POLICY_INVALID_REQUEST: i32 = 1;
pub const SPCTRE_POLICY_RESOURCE_LIMIT: i32 = 2;
pub const SPCTRE_POLICY_SERIALIZATION_ERROR: i32 = 3;
pub const SPCTRE_POLICY_INTERNAL_ERROR: i32 = 4;

pub const MAX_REQUEST_BYTES: usize = 1_048_576;
pub const MAX_RESPONSE_BYTES: usize = 1_048_576;

/// Runs kernel work that must never unwind into a foreign caller.
///
/// A panic crossing an `extern "C"` boundary aborts the process, which would
/// turn a single pathological evaluation into the loss of the whole host — for
/// the Go worker, every in-flight request on the instance. Converting it to an
/// explicit status lets the host fail that one decision closed instead.
fn guard<T>(work: impl FnOnce() -> T) -> Result<T, i32> {
    panic::catch_unwind(AssertUnwindSafe(work)).map_err(|_| SPCTRE_POLICY_INTERNAL_ERROR)
}

/// Evaluates a versioned policy request encoded as UTF-8 JSON.
///
/// A nonzero result is an explicit failure; hosts must fail closed and must
/// not inspect `out_ptr` or `out_len` in that case.
#[no_mangle]
pub unsafe extern "C" fn spctre_policy_evaluate(
    request_ptr: *const u8,
    request_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if out_ptr.is_null()
        || out_len.is_null()
        || request_ptr.is_null()
        || request_len > MAX_REQUEST_BYTES
    {
        return SPCTRE_POLICY_RESOURCE_LIMIT;
    }
    // SAFETY: the C caller promises `request_ptr` points to `request_len`
    // readable bytes for the duration of this call.
    let request = unsafe { std::slice::from_raw_parts(request_ptr, request_len) };
    let response = match guard(|| evaluate_request(request)) {
        Ok(Ok(response)) => response,
        Ok(Err(status)) => return status,
        Err(status) => return status,
    };
    let response_len = response.len();
    let response_ptr = Box::into_raw(response.into_boxed_slice()) as *mut u8;
    // SAFETY: both out parameters were checked non-null above and point to
    // caller-provided writable storage.
    unsafe {
        ptr::write(out_ptr, response_ptr);
        ptr::write(out_len, response_len);
    }
    SPCTRE_POLICY_OK
}

/// Composes ordered policy layers, returning the winning positions and conflict
/// notes as bounded UTF-8 JSON. Same ownership and status contract as
/// `spctre_policy_evaluate`.
#[no_mangle]
pub unsafe extern "C" fn spctre_policy_compose_layers(
    request_ptr: *const u8,
    request_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if out_ptr.is_null()
        || out_len.is_null()
        || request_ptr.is_null()
        || request_len > MAX_REQUEST_BYTES
    {
        return SPCTRE_POLICY_RESOURCE_LIMIT;
    }
    // SAFETY: as in `spctre_policy_evaluate`, the caller guarantees the request
    // bytes are readable for the duration of this call.
    let request = unsafe { std::slice::from_raw_parts(request_ptr, request_len) };
    let response = match guard(|| compose_request(request)) {
        Ok(Ok(response)) => response,
        Ok(Err(status)) => return status,
        Err(status) => return status,
    };
    let response_len = response.len();
    let response_ptr = Box::into_raw(response.into_boxed_slice()) as *mut u8;
    // SAFETY: both out parameters were checked non-null above.
    unsafe {
        ptr::write(out_ptr, response_ptr);
        ptr::write(out_len, response_len);
    }
    SPCTRE_POLICY_OK
}

/// Validates a bundle for enforceability, as bounded UTF-8 JSON. Same ownership
/// and status contract as `spctre_policy_evaluate`.
#[no_mangle]
pub unsafe extern "C" fn spctre_policy_validate_bundle(
    request_ptr: *const u8,
    request_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if out_ptr.is_null()
        || out_len.is_null()
        || request_ptr.is_null()
        || request_len > MAX_REQUEST_BYTES
    {
        return SPCTRE_POLICY_RESOURCE_LIMIT;
    }
    // SAFETY: as in `spctre_policy_evaluate`.
    let request = unsafe { std::slice::from_raw_parts(request_ptr, request_len) };
    let response = match guard(|| validate_request(request)) {
        Ok(Ok(response)) => response,
        Ok(Err(status)) => return status,
        Err(status) => return status,
    };
    let response_len = response.len();
    let response_ptr = Box::into_raw(response.into_boxed_slice()) as *mut u8;
    // SAFETY: both out parameters were checked non-null above.
    unsafe {
        ptr::write(out_ptr, response_ptr);
        ptr::write(out_len, response_len);
    }
    SPCTRE_POLICY_OK
}

fn validate_request(request: &[u8]) -> Result<Vec<u8>, i32> {
    let parsed: PolicyBundleValidationRequest =
        serde_json::from_slice(request).map_err(|_| SPCTRE_POLICY_INVALID_REQUEST)?;
    match serde_json::to_vec(&validate_policy_bundle(&parsed)) {
        Ok(response) if response.len() <= MAX_RESPONSE_BYTES => Ok(response),
        Ok(_) => Err(SPCTRE_POLICY_RESOURCE_LIMIT),
        Err(_) => Err(SPCTRE_POLICY_SERIALIZATION_ERROR),
    }
}

fn compose_request(request: &[u8]) -> Result<Vec<u8>, i32> {
    let parsed: CompositionRequest =
        serde_json::from_slice(request).map_err(|_| SPCTRE_POLICY_INVALID_REQUEST)?;
    match serde_json::to_vec(&compose_layer_selection(&parsed.layers)) {
        Ok(response) if response.len() <= MAX_RESPONSE_BYTES => Ok(response),
        Ok(_) => Err(SPCTRE_POLICY_RESOURCE_LIMIT),
        Err(_) => Err(SPCTRE_POLICY_SERIALIZATION_ERROR),
    }
}

/// Deserializes, evaluates, and reserializes one request. Held separate from
/// the ABI entry point so all of it runs under the panic guard, and so no raw
/// pointer is live across the guarded call.
fn evaluate_request(request: &[u8]) -> Result<Vec<u8>, i32> {
    let input: PolicyEvaluationInput =
        serde_json::from_slice(request).map_err(|_| SPCTRE_POLICY_INVALID_REQUEST)?;
    match serde_json::to_vec(&evaluate_policy_decision(input)) {
        Ok(response) if response.len() <= MAX_RESPONSE_BYTES => Ok(response),
        Ok(_) => Err(SPCTRE_POLICY_RESOURCE_LIMIT),
        Err(_) => Err(SPCTRE_POLICY_SERIALIZATION_ERROR),
    }
}

/// Reserves `len` bytes the caller can write a request into.
///
/// A WASM host cannot hand the kernel a pointer into its own memory: the module
/// can only read the linear memory it owns. So a portable host allocates here,
/// copies the request bytes in, calls an entry point, and frees with
/// `spctre_policy_buffer_free` — the same ownership rule as a response buffer.
/// In-process C hosts do not need this and keep passing their own pointers.
#[no_mangle]
pub unsafe extern "C" fn spctre_policy_buffer_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_REQUEST_BYTES {
        return ptr::null_mut();
    }
    let buffer = vec![0u8; len].into_boxed_slice();
    Box::into_raw(buffer) as *mut u8
}

/// Releases a buffer returned from `spctre_policy_evaluate`,
/// `spctre_policy_compose_layers`, `spctre_policy_validate_bundle`, or
/// `spctre_policy_buffer_alloc`.
#[no_mangle]
pub unsafe extern "C" fn spctre_policy_buffer_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: this exact pointer/length pair comes from one of the kernel's own
    // entry points, each of which allocated a boxed `[u8]` of this length.
    unsafe {
        drop(Box::from_raw(std::slice::from_raw_parts_mut(ptr, len)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_abi_round_trip_returns_versioned_decision() {
        let request = br#"{"connector":"test","action":"run","rules":[],"policyArtifactHash":"sha256:fixture"}"#;
        let mut response_ptr = ptr::null_mut();
        let mut response_len = 0;
        let result = unsafe {
            spctre_policy_evaluate(
                request.as_ptr(),
                request.len(),
                &mut response_ptr,
                &mut response_len,
            )
        };
        assert_eq!(result, SPCTRE_POLICY_OK);
        let response = unsafe { std::slice::from_raw_parts(response_ptr, response_len) };
        let value: serde_json::Value = serde_json::from_slice(response).unwrap();
        assert_eq!(value["status"], "ALLOW");
        assert_eq!(value["evaluatorVersion"], "1.0");
        assert_eq!(value["policyArtifactHash"], "sha256:fixture");
        unsafe { spctre_policy_buffer_free(response_ptr, response_len) };
    }

    // The composition ABI must agree with the composition the evaluator uses
    // internally; two implementations of layer precedence is the failure this
    // whole boundary exists to prevent.
    #[test]
    fn c_abi_composition_matches_the_internal_composition() {
        let request = br#"{"layers":[
            {"scope":"ORGANIZATION","rules":[{"stableRuleId":"locked","immutable":true},{"stableRuleId":"open"}]},
            {"scope":"WORKSPACE","rules":[{"stableRuleId":"locked"},{"stableRuleId":"open"}]}
        ]}"#;
        let mut response_ptr = ptr::null_mut();
        let mut response_len = 0;
        let status = unsafe {
            spctre_policy_compose_layers(
                request.as_ptr(),
                request.len(),
                &mut response_ptr,
                &mut response_len,
            )
        };
        assert_eq!(status, SPCTRE_POLICY_OK);
        let response = unsafe { std::slice::from_raw_parts(response_ptr, response_len) };
        let value: serde_json::Value = serde_json::from_slice(response).unwrap();

        // "locked" keeps the organization layer; "open" is taken by the workspace.
        assert_eq!(value["effective"][0]["layerIndex"], 0);
        assert_eq!(value["effective"][0]["stableRuleId"], "locked");
        assert_eq!(value["effective"][1]["layerIndex"], 1);
        assert_eq!(value["effective"][1]["stableRuleId"], "open");
        assert_eq!(value["conflictNotes"].as_array().unwrap().len(), 2);
        unsafe { spctre_policy_buffer_free(response_ptr, response_len) };
    }

    #[test]
    fn c_abi_composition_rejects_malformed_input() {
        let request = b"{\"layers\":\"not a list\"}";
        let mut response_ptr = ptr::null_mut();
        let mut response_len = 0;
        assert_eq!(
            unsafe {
                spctre_policy_compose_layers(
                    request.as_ptr(),
                    request.len(),
                    &mut response_ptr,
                    &mut response_len,
                )
            },
            SPCTRE_POLICY_INVALID_REQUEST,
        );
    }

    // The portable host allocates through the kernel, writes its request into
    // that buffer, and frees it afterwards.
    #[test]
    fn alloc_round_trips_a_request_buffer() {
        let request = br#"{"connector":"test","action":"run","rules":[]}"#;
        let buffer = unsafe { spctre_policy_buffer_alloc(request.len()) };
        assert!(!buffer.is_null());
        unsafe { std::ptr::copy_nonoverlapping(request.as_ptr(), buffer, request.len()) };

        let mut response_ptr = ptr::null_mut();
        let mut response_len = 0;
        let status = unsafe {
            spctre_policy_evaluate(buffer, request.len(), &mut response_ptr, &mut response_len)
        };
        assert_eq!(status, SPCTRE_POLICY_OK);
        unsafe { spctre_policy_buffer_free(response_ptr, response_len) };
        unsafe { spctre_policy_buffer_free(buffer, request.len()) };
    }

    #[test]
    fn alloc_refuses_a_length_outside_the_request_bound() {
        assert!(unsafe { spctre_policy_buffer_alloc(0) }.is_null());
        assert!(unsafe { spctre_policy_buffer_alloc(MAX_REQUEST_BYTES + 1) }.is_null());
    }

    #[test]
    fn guard_converts_a_panic_into_an_internal_error_status() {
        let previous = panic::take_hook();
        panic::set_hook(Box::new(|_| {}));
        let result = guard(|| panic!("pathological evaluation"));
        panic::set_hook(previous);
        assert_eq!(result.unwrap_err(), SPCTRE_POLICY_INTERNAL_ERROR);
    }

    #[test]
    fn guard_passes_through_a_normal_result() {
        assert_eq!(guard(|| 7).unwrap(), 7);
    }

    #[test]
    fn c_abi_rejects_malformed_input() {
        let request = b"not json";
        let mut response_ptr = ptr::null_mut();
        let mut response_len = 0;
        assert_eq!(
            unsafe {
                spctre_policy_evaluate(
                    request.as_ptr(),
                    request.len(),
                    &mut response_ptr,
                    &mut response_len,
                )
            },
            SPCTRE_POLICY_INVALID_REQUEST,
        );
    }

    #[test]
    fn c_abi_accepts_null_rule_vectors_from_delivery_adapters() {
        let request = br#"{"connector":"test","action":"run","rules":null,"layers":[{"scope":"WORKSPACE","rules":null}]}"#;
        let mut response_ptr = ptr::null_mut();
        let mut response_len = 0;
        assert_eq!(
            unsafe {
                spctre_policy_evaluate(
                    request.as_ptr(),
                    request.len(),
                    &mut response_ptr,
                    &mut response_len,
                )
            },
            SPCTRE_POLICY_OK,
        );
        unsafe { spctre_policy_buffer_free(response_ptr, response_len) };
    }
}
