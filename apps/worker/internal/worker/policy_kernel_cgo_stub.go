//go:build !cgo || !spctre_policy_kernel

package worker

import "errors"

// evaluatePolicyRulesWithKernel fails closed in builds that did not link the
// Rust policy kernel. Production worker images always set the matching build
// tag; this guard prevents an accidental return to the Go evaluator.
func evaluatePolicyRulesWithKernel(_ PolicyEvaluationInput) (PolicyEvaluationResult, error) {
	return PolicyEvaluationResult{}, errors.New("Rust policy kernel is not linked into this worker build")
}
