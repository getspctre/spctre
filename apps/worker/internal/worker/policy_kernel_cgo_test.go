//go:build cgo && spctre_policy_kernel

package worker

import "testing"

func TestPolicyKernelCgoAdapter(t *testing.T) {
	input := PolicyEvaluationInput{
		Connector: "test", Action: "run", Rules: []PolicyRule{{
			StableRuleID: "deny", Title: "deny test", Effect: statusDeny,
			Actions: []string{"run"},
		}},
	}
	result, err := evaluatePolicyRulesWithKernel(input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != statusDeny || len(result.MatchedRefs) != 1 || result.MatchedRefs[0] != "deny" {
		t.Fatalf("unexpected kernel result: %#v", result)
	}
}
