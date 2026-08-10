//go:build cgo && spctre_policy_kernel

package worker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// This is an adapter integration test, not a second evaluator parity test. The
// reviewed contract corpus is passed through cgo to the one kernel, and the
// assertion is that this delivery path preserves what the kernel decided —
// status, matched refs, the trace, the evaluator version and the artifact hash.
// An adapter that quietly drops any of them produces decisions that cannot be
// replayed, which is how the metadata went missing before.
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
				ToolParameters:     testCase.ToolParameters,
				PolicyArtifactHash: "sha256:corpus",
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

			if result.EvaluatorVersion != "1.0" {
				t.Errorf("evaluator version: got %q, want 1.0", result.EvaluatorVersion)
			}
			if result.RequestSchemaVersion != "1.0" || result.ResultSchemaVersion != "1.0" {
				t.Errorf("schema versions: got %q/%q, want 1.0/1.0",
					result.RequestSchemaVersion, result.ResultSchemaVersion)
			}
			if result.PolicyArtifactHash == nil || *result.PolicyArtifactHash != "sha256:corpus" {
				t.Errorf("artifact hash was not round-tripped: %v", result.PolicyArtifactHash)
			}
			if len(result.Trace) != len(testCase.Rules) {
				t.Errorf("trace: got %d steps, want one per evaluated rule (%d)",
					len(result.Trace), len(testCase.Rules))
			}
			if result.RuleCount != len(testCase.Rules) {
				t.Errorf("rule count: got %d, want %d", result.RuleCount, len(testCase.Rules))
			}
		})
	}
}
