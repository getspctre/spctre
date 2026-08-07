//go:build cgo && spctre_policy_kernel

package worker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// This is an adapter integration test, not a second evaluator parity test.
// The reviewed contract corpus is passed through cgo to the Rust kernel.
func TestPolicyKernelAdapterContractCorpus(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("../../../..", "conformance/policy-rules.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Cases []struct {
			Description    string         `json:"description"`
			Rules          []PolicyRule   `json:"rules"`
			Connector      string         `json:"connector"`
			Action         string         `json:"action"`
			Domains        []string       `json:"domains"`
			ToolIntent     string         `json:"toolIntent"`
			PlanSummary    string         `json:"planSummary"`
			ToolParameters map[string]any `json:"toolParameters"`
			Expected       struct {
				Status      RuntimeDecisionStatus `json:"status"`
				MatchedRefs []string              `json:"matchedRefs"`
			} `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) == 0 {
		t.Fatal("policy kernel contract corpus is empty")
	}
	for _, testCase := range corpus.Cases {
		t.Run(testCase.Description, func(t *testing.T) {
			result, err := evaluatePolicyRulesWithKernel(PolicyEvaluationInput{
				Connector: testCase.Connector, Action: testCase.Action, Domains: testCase.Domains,
				Rules: testCase.Rules, ToolIntent: testCase.ToolIntent, PlanSummary: testCase.PlanSummary,
				ToolParameters: testCase.ToolParameters,
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != testCase.Expected.Status {
				t.Fatalf("status: got %s, want %s", result.Status, testCase.Expected.Status)
			}
			if len(result.MatchedRefs) != len(testCase.Expected.MatchedRefs) {
				t.Fatalf("matched refs: got %v, want %v", result.MatchedRefs, testCase.Expected.MatchedRefs)
			}
			for index := range result.MatchedRefs {
				if result.MatchedRefs[index] != testCase.Expected.MatchedRefs[index] {
					t.Fatalf("matched refs: got %v, want %v", result.MatchedRefs, testCase.Expected.MatchedRefs)
				}
			}
		})
	}
}
