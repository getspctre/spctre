//go:build cgo && spctre_policy_kernel

package worker

import "slices"

// observePolicyKernelShadow records only bounded decision metadata. It never
// logs tool parameters, semantic text, or rule content. A failure or mismatch
// cannot alter the established Go verdict while this path is in shadow mode.
func (s *Server) observePolicyKernelShadow(input PolicyEvaluationInput, established PolicyEvaluationResult) {
	kernel, err := evaluatePolicyRulesWithKernel(input)
	if err != nil {
		s.logger.Warn("policy kernel shadow evaluation failed", "event", "policy.kernel_shadow_error", "error", err.Error())
		return
	}
	if kernel.Status != established.Status || !slices.Equal(kernel.MatchedRefs, established.MatchedRefs) {
		s.logger.Warn(
			"policy kernel shadow mismatch",
			"event", "policy.kernel_shadow_mismatch",
			"go_status", established.Status,
			"kernel_status", kernel.Status,
			"go_match_count", len(established.MatchedRefs),
			"kernel_match_count", len(kernel.MatchedRefs),
		)
	}
}
