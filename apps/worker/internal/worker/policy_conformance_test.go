package worker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Conformance between the Go and TypeScript published-rule engines.
//
// Both engines evaluate the same rules against the same fixtures and must
// reach the same verdict. The rules come from conformance/policy-packs.json,
// generated from POLICY_PACKS by scripts/generate-worker-policy-data.mjs and
// byte-checked in CI; the fixtures are the very files
// packages/policy-schema/tests/pack-fixtures.test.ts runs against.
//
// If this test and its TypeScript counterpart disagree, the two engines have
// drifted — which is the failure mode this whole arrangement exists to catch.

const repoRoot = "../../../.."

type packFixture struct {
	Description    string         `json:"description"`
	Action         string         `json:"action"`
	Domains        []string       `json:"domains"`
	ToolIntent     string         `json:"toolIntent"`
	PlanSummary    string         `json:"planSummary"`
	ToolParameters map[string]any `json:"toolParameters"`
	Expected       struct {
		Status      RuntimeDecisionStatus `json:"status"`
		MatchedRefs []string              `json:"matchedRefs"`
	} `json:"expected"`
}

type generatedPacks struct {
	Packs map[string][]PolicyRule `json:"packs"`
}

func loadGeneratedPacks(t *testing.T) map[string][]PolicyRule {
	t.Helper()
	path := filepath.Join(repoRoot, "conformance/policy-packs.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v (run: pnpm generate:worker-policy-data)", path, err)
	}
	var decoded generatedPacks
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(decoded.Packs) == 0 {
		t.Fatalf("%s contains no packs", path)
	}
	return decoded.Packs
}

func TestPolicyEngineConformanceWithTypeScript(t *testing.T) {
	packs := loadGeneratedPacks(t)
	fixturesRoot := filepath.Join(repoRoot, "packages/policy-schema/tests/fixtures/packs")

	totalFixtures := 0
	for connector, rules := range packs {
		connectorDir := filepath.Join(fixturesRoot, connector)
		entries, err := os.ReadDir(connectorDir)
		if err != nil {
			t.Fatalf("read fixture dir %s: %v", connectorDir, err)
		}

		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			path := filepath.Join(connectorDir, entry.Name())
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read fixture %s: %v", path, err)
			}
			var fixture packFixture
			if err := json.Unmarshal(raw, &fixture); err != nil {
				t.Fatalf("parse fixture %s: %v", path, err)
			}
			totalFixtures++

			t.Run(connector+"/"+entry.Name(), func(t *testing.T) {
				result := evaluatePolicyRules(PolicyEvaluationInput{
					Connector:      connector,
					Action:         fixture.Action,
					Domains:        fixture.Domains,
					Rules:          rules,
					ToolIntent:     fixture.ToolIntent,
					PlanSummary:    fixture.PlanSummary,
					ToolParameters: fixture.ToolParameters,
				})

				if result.Status != fixture.Expected.Status {
					t.Errorf("%s\nstatus: got %q, want %q\nreason: %s",
						fixture.Description, result.Status, fixture.Expected.Status, result.Reason)
				}
				if !equalStrings(result.MatchedRefs, fixture.Expected.MatchedRefs) {
					t.Errorf("%s\nmatchedRefs: got %v, want %v",
						fixture.Description, result.MatchedRefs, fixture.Expected.MatchedRefs)
				}
			})
		}
	}

	// Guards against the corpus silently emptying out — a passing run over zero
	// fixtures would otherwise look identical to real conformance.
	if totalFixtures == 0 {
		t.Fatal("no conformance fixtures were executed")
	}
	t.Logf("conformance: %d fixtures across %d connectors", totalFixtures, len(packs))
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

type semanticCase struct {
	Prompt         string         `json:"prompt"`
	ToolIntent     string         `json:"toolIntent"`
	PlanSummary    string         `json:"planSummary"`
	ToolParameters map[string]any `json:"toolParameters"`
	Expected       bool           `json:"expected"`
}

// TestSemanticIntentConformanceWithTypeScript holds the Go semantic matcher to
// the TypeScript implementation across a matrix derived from the topic tables.
//
// This is the highest drift risk in the port: the matcher is pure heuristic
// logic with no type-level contract, so nothing but a corpus like this would
// notice the two implementations diverging.
func TestSemanticIntentConformanceWithTypeScript(t *testing.T) {
	path := filepath.Join(repoRoot, "conformance/semantic-intent.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v (run: pnpm generate:worker-policy-data)", path, err)
	}
	var decoded struct {
		Cases []semanticCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(decoded.Cases) == 0 {
		t.Fatalf("%s contains no cases", path)
	}

	divergent := 0
	for i, testCase := range decoded.Cases {
		got := classifySemanticIntent(
			testCase.Prompt, testCase.ToolIntent, testCase.PlanSummary, testCase.ToolParameters,
		)
		if got != testCase.Expected {
			divergent++
			if divergent <= 10 {
				t.Errorf("case %d diverges from TypeScript: got %v, want %v\n  prompt=%q intent=%q plan=%q params=%v",
					i, got, testCase.Expected, testCase.Prompt, testCase.ToolIntent,
					testCase.PlanSummary, testCase.ToolParameters)
			}
		}
	}
	if divergent > 10 {
		t.Errorf("... and %d further divergences", divergent-10)
	}
	t.Logf("semantic conformance: %d cases, %d divergent", len(decoded.Cases), divergent)
}

type ruleCase struct {
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
}

type compositionCase struct {
	Description           string             `json:"description"`
	Layers                []CompositionLayer `json:"layers"`
	ExpectedRuleIDs       []string           `json:"expectedRuleIds"`
	ExpectedEffects       []string           `json:"expectedEffects"`
	ExpectedConflictNotes []string           `json:"expectedConflictNotes"`
}

// TestRuleEngineConformanceWithTypeScript covers evaluator behaviour the pack
// fixtures never reach — wildcard actions, effect overrides, operator edge
// cases and effect precedence. Mutation testing showed the pack corpus alone
// left those paths unguarded.
func TestRuleEngineConformanceWithTypeScript(t *testing.T) {
	path := filepath.Join(repoRoot, "conformance/policy-rules.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v (run: pnpm generate:worker-policy-data)", path, err)
	}
	var decoded struct {
		Cases            []ruleCase        `json:"cases"`
		CompositionCases []compositionCase `json:"compositionCases"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(decoded.Cases) == 0 || len(decoded.CompositionCases) == 0 {
		t.Fatalf("%s is missing cases", path)
	}

	for _, testCase := range decoded.Cases {
		t.Run(testCase.Description, func(t *testing.T) {
			result := evaluatePolicyRules(PolicyEvaluationInput{
				Connector:      testCase.Connector,
				Action:         testCase.Action,
				Domains:        testCase.Domains,
				Rules:          testCase.Rules,
				ToolIntent:     testCase.ToolIntent,
				PlanSummary:    testCase.PlanSummary,
				ToolParameters: testCase.ToolParameters,
			})
			if result.Status != testCase.Expected.Status {
				t.Errorf("status: got %q, want %q (reason: %s)",
					result.Status, testCase.Expected.Status, result.Reason)
			}
			if !equalStrings(result.MatchedRefs, testCase.Expected.MatchedRefs) {
				t.Errorf("matchedRefs: got %v, want %v",
					result.MatchedRefs, testCase.Expected.MatchedRefs)
			}
		})
	}

	for _, testCase := range decoded.CompositionCases {
		t.Run("compose/"+testCase.Description, func(t *testing.T) {
			effective, notes := composePolicyLayers(testCase.Layers)
			gotIDs := make([]string, 0, len(effective))
			gotEffects := make([]string, 0, len(effective))
			for _, rule := range effective {
				gotIDs = append(gotIDs, rule.StableRuleID)
				gotEffects = append(gotEffects, string(rule.Effect))
			}
			if !equalStrings(gotIDs, testCase.ExpectedRuleIDs) {
				t.Errorf("effective rule ids: got %v, want %v", gotIDs, testCase.ExpectedRuleIDs)
			}
			if !equalStrings(gotEffects, testCase.ExpectedEffects) {
				t.Errorf("effective effects: got %v, want %v", gotEffects, testCase.ExpectedEffects)
			}
			if !equalStrings(notes, testCase.ExpectedConflictNotes) {
				t.Errorf("conflict notes: got %v, want %v", notes, testCase.ExpectedConflictNotes)
			}
		})
	}
}
