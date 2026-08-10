package worker

import (
	"fmt"
	"strings"
)

// The published-evaluator contract major version this service understands.
//
// PUBLISHED_EVALUATOR_CONTRACT.md makes compatibility major-versioned: a
// consumer may accept a contract version only when it recognizes that major
// version, and must reject an unknown one rather than applying
// presumed-compatible semantics. A kernel upgraded past this line changes what
// a decision means, so enforcing on it would silently reinterpret policy.
const publishedEvaluatorContractMajor = "1"

// policyKernelProvenance is what a kernel-made decision must retain to be
// replayable: which published artifact was enforced, and which evaluator
// interpreted it.
//
// The bounded trace is deliberately not persisted per decision. It is
// regenerable by replaying the recorded artifact through the recorded evaluator
// version, so storing it on every gateway decision would buy nothing and grow
// with rule count. The trace is still asserted across delivery adapters by the
// conformance tests.
type policyKernelProvenance struct {
	EvaluatorVersion string
	ArtifactHash     string
}

func newPolicyKernelProvenance(
	composition publishedPolicyComposition,
	result PolicyEvaluationResult,
) *policyKernelProvenance {
	// Prefer the hash the kernel echoed back: agreement between what was sent
	// and what was evaluated is the point of round-tripping it.
	artifactHash := composition.ArtifactHash
	if result.PolicyArtifactHash != nil && *result.PolicyArtifactHash != "" {
		artifactHash = *result.PolicyArtifactHash
	}
	return &policyKernelProvenance{
		EvaluatorVersion: result.EvaluatorVersion,
		ArtifactHash:     artifactHash,
	}
}

// policyProvenanceHash and policyProvenanceEvaluator bind provenance for
// persistence. Both are NULL when no published policy applied to the decision,
// which is distinct from a decision made against an empty artifact.
func policyProvenanceHash(provenance *policyKernelProvenance) *string {
	if provenance == nil || provenance.ArtifactHash == "" {
		return nil
	}
	return &provenance.ArtifactHash
}

func policyProvenanceEvaluator(provenance *policyKernelProvenance) *string {
	if provenance == nil || provenance.EvaluatorVersion == "" {
		return nil
	}
	return &provenance.EvaluatorVersion
}

// validateEvaluatorContract rejects a kernel result this service cannot
// interpret. It is deliberately separate from the cgo adapter so it is
// exercised without a linked static library, and it checks the versions the
// kernel reports rather than the ones the adapter hoped for.
func validateEvaluatorContract(result PolicyEvaluationResult) error {
	for _, version := range []struct {
		field string
		value string
	}{
		{"evaluatorVersion", result.EvaluatorVersion},
		{"requestSchemaVersion", result.RequestSchemaVersion},
		{"resultSchemaVersion", result.ResultSchemaVersion},
	} {
		if version.value == "" {
			return fmt.Errorf("policy kernel omitted %s", version.field)
		}
		major, _, found := strings.Cut(version.value, ".")
		if !found || major != publishedEvaluatorContractMajor {
			return fmt.Errorf(
				"policy kernel reported unsupported %s %q (this service understands major %s)",
				version.field, version.value, publishedEvaluatorContractMajor,
			)
		}
	}
	return nil
}
