//go:build cgo && spctre_policy_kernel

package worker

/*
#cgo CFLAGS: -I${SRCDIR}/../../../../packages/policy-schema/native/include
#cgo LDFLAGS: ${SRCDIR}/../../../../packages/policy-schema/native/target/release/libspctre_policy_core.a
#include <stdlib.h>
#include "spctre_policy_core.h"
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"unsafe"
)

type policyKernelRequest struct {
	Connector      string             `json:"connector"`
	Action         string             `json:"action"`
	Domains        []string           `json:"domains"`
	Rules          []PolicyRule       `json:"rules"`
	Layers         []CompositionLayer `json:"layers"`
	ToolIntent     string             `json:"toolIntent"`
	PlanSummary    string             `json:"planSummary"`
	ToolParameters map[string]any     `json:"toolParameters"`
}

func marshalPolicyKernelRequest(input PolicyEvaluationInput) ([]byte, error) {
	parameters := input.ToolParameters
	if parameters == nil {
		parameters = map[string]any{}
	}
	return json.Marshal(policyKernelRequest{
		Connector: input.Connector, Action: input.Action, Domains: input.Domains,
		Rules: input.Rules, Layers: input.Layers, ToolIntent: input.ToolIntent, PlanSummary: input.PlanSummary,
		ToolParameters: parameters,
	})
}

// evaluatePolicyRulesWithKernel is the cgo delivery adapter. It performs no
// policy logic: it serializes the stable request contract, invokes the Rust
// kernel, and deserializes its deterministic result. Callers fail closed on a
// nonzero ABI status.
func evaluatePolicyRulesWithKernel(input PolicyEvaluationInput) (PolicyEvaluationResult, error) {
	request, err := marshalPolicyKernelRequest(input)
	if err != nil {
		return PolicyEvaluationResult{}, fmt.Errorf("encode policy kernel request: %w", err)
	}
	if len(request) == 0 {
		return PolicyEvaluationResult{}, fmt.Errorf("encode policy kernel request: empty request")
	}

	var responsePtr *C.uint8_t
	var responseLen C.size_t
	status := C.spctre_policy_evaluate(
		(*C.uint8_t)(unsafe.Pointer(&request[0])), C.size_t(len(request)), &responsePtr, &responseLen,
	)
	if status != C.SPCTRE_POLICY_OK {
		return PolicyEvaluationResult{}, fmt.Errorf("policy kernel ABI failed with status %d", status)
	}
	defer C.spctre_policy_buffer_free(responsePtr, responseLen)
	response := C.GoBytes(unsafe.Pointer(responsePtr), C.int(responseLen))
	var result PolicyEvaluationResult
	if err := json.Unmarshal(response, &result); err != nil {
		return PolicyEvaluationResult{}, fmt.Errorf("decode policy kernel response: %w", err)
	}
	return result, nil
}
