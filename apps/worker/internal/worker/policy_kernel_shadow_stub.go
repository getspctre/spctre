//go:build !cgo || !spctre_policy_kernel

package worker

// observePolicyKernelShadow is intentionally inert outside the explicit cgo
// shadow build. The established Go evaluator remains the production authority
// until a deployment image links the Rust static library and passes rollout
// gates.
func (s *Server) observePolicyKernelShadow(_ PolicyEvaluationInput, _ PolicyEvaluationResult) {}
