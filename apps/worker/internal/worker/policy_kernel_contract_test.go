package worker

import "testing"

func supportedResult() PolicyEvaluationResult {
	return PolicyEvaluationResult{
		Status:               statusAllow,
		EvaluatorVersion:     "1.0",
		RequestSchemaVersion: "1.0",
		ResultSchemaVersion:  "1.0",
	}
}

func TestValidateEvaluatorContractAcceptsTheSupportedMajor(t *testing.T) {
	if err := validateEvaluatorContract(supportedResult()); err != nil {
		t.Fatalf("supported contract rejected: %v", err)
	}

	// A minor bump adds optional fields without reinterpreting existing ones.
	minor := supportedResult()
	minor.EvaluatorVersion = "1.7"
	if err := validateEvaluatorContract(minor); err != nil {
		t.Fatalf("minor version rejected: %v", err)
	}
}

// A kernel past this service's major version changes what a decision means.
// Enforcing on it would silently reinterpret published policy.
func TestValidateEvaluatorContractRejectsAnUnknownMajor(t *testing.T) {
	for _, unsupported := range []string{"2.0", "0.9", "1", ""} {
		result := supportedResult()
		result.EvaluatorVersion = unsupported
		if err := validateEvaluatorContract(result); err == nil {
			t.Errorf("evaluator version %q was accepted", unsupported)
		}
	}
}

func TestValidateEvaluatorContractChecksEverySchemaVersion(t *testing.T) {
	request := supportedResult()
	request.RequestSchemaVersion = "2.0"
	if err := validateEvaluatorContract(request); err == nil {
		t.Error("an unsupported request-schema version was accepted")
	}

	response := supportedResult()
	response.ResultSchemaVersion = ""
	if err := validateEvaluatorContract(response); err == nil {
		t.Error("a missing result-schema version was accepted")
	}
}

func TestProvenancePrefersTheHashTheKernelEchoed(t *testing.T) {
	echoed := "sha256:" + strings32("a")
	result := supportedResult()
	result.PolicyArtifactHash = &echoed

	provenance := newPolicyKernelProvenance(
		publishedPolicyComposition{ArtifactHash: "sha256:" + strings32("b")}, result,
	)
	if provenance.ArtifactHash != echoed {
		t.Errorf("artifact hash = %q, want the echoed %q", provenance.ArtifactHash, echoed)
	}
	if provenance.EvaluatorVersion != "1.0" {
		t.Errorf("evaluator version = %q, want 1.0", provenance.EvaluatorVersion)
	}
}

// An older kernel that does not echo the hash must not erase what was sent.
func TestProvenanceFallsBackToTheSentHash(t *testing.T) {
	sent := "sha256:" + strings32("c")
	provenance := newPolicyKernelProvenance(
		publishedPolicyComposition{ArtifactHash: sent}, supportedResult(),
	)
	if provenance.ArtifactHash != sent {
		t.Errorf("artifact hash = %q, want the sent %q", provenance.ArtifactHash, sent)
	}
}

// Nothing published is distinct from an empty artifact: both columns stay NULL.
func TestProvenanceBindingIsNullWithoutProvenance(t *testing.T) {
	if policyProvenanceHash(nil) != nil || policyProvenanceEvaluator(nil) != nil {
		t.Error("absent provenance must bind as NULL")
	}
	empty := &policyKernelProvenance{}
	if policyProvenanceHash(empty) != nil || policyProvenanceEvaluator(empty) != nil {
		t.Error("empty provenance must bind as NULL rather than an empty string")
	}
}

func strings32(char string) string {
	out := ""
	for len(out) < 64 {
		out += char
	}
	return out
}
