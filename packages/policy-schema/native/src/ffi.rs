//! Stable JSON-bytes C ABI for in-process hosts such as the Go worker.
//!
//! The ABI deliberately exposes no Rust layouts. Callers own no returned
//! allocation: they must release every successful response with
//! `spctre_policy_buffer_free` using the pointer and length returned here.

use std::ptr;

use crate::{evaluate_policy_decision, PolicyEvaluationInput};

pub const SPCTRE_POLICY_OK: i32 = 0;
pub const SPCTRE_POLICY_INVALID_REQUEST: i32 = 1;
pub const SPCTRE_POLICY_RESOURCE_LIMIT: i32 = 2;
pub const SPCTRE_POLICY_SERIALIZATION_ERROR: i32 = 3;

pub const MAX_REQUEST_BYTES: usize = 1_048_576;
pub const MAX_RESPONSE_BYTES: usize = 1_048_576;

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
    let input: PolicyEvaluationInput = match serde_json::from_slice(request) {
        Ok(input) => input,
        Err(_) => return SPCTRE_POLICY_INVALID_REQUEST,
    };
    let response = match serde_json::to_vec(&evaluate_policy_decision(input)) {
        Ok(response) if response.len() <= MAX_RESPONSE_BYTES => response,
        Ok(_) => return SPCTRE_POLICY_RESOURCE_LIMIT,
        Err(_) => return SPCTRE_POLICY_SERIALIZATION_ERROR,
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

/// Releases a buffer returned from `spctre_policy_evaluate`.
#[no_mangle]
pub unsafe extern "C" fn spctre_policy_buffer_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: this exact pointer/length pair is returned only by
    // `spctre_policy_evaluate`, which allocated a boxed `[u8]` of this length.
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
}
