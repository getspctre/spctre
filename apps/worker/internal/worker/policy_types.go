package worker

// Policy request and result wire types. Evaluation is implemented only by the
// linked Rust kernel; these Go declarations contain no policy semantics.
type SemanticCheck struct {
	ID     string                 `json:"id"`
	Prompt string                 `json:"prompt"`
	Effect *RuntimeDecisionStatus `json:"effect,omitempty"`
}

type PolicyParameterConstraint struct {
	Field    string                 `json:"field"`
	Operator string                 `json:"operator"`
	Value    any                    `json:"value"`
	Effect   *RuntimeDecisionStatus `json:"effect,omitempty"`
}

type PolicyRule struct {
	StableRuleID         string                      `json:"stableRuleId"`
	Title                string                      `json:"title"`
	Effect               RuntimeDecisionStatus       `json:"effect"`
	Domains              []string                    `json:"domains"`
	Connectors           []string                    `json:"connectors"`
	Actions              []string                    `json:"actions"`
	Immutable            bool                        `json:"immutable"`
	SemanticChecks       []SemanticCheck             `json:"semanticChecks,omitempty"`
	ParameterConstraints []PolicyParameterConstraint `json:"parameterConstraints,omitempty"`
}

type CompositionLayer struct {
	Scope string       `json:"scope"`
	Rules []PolicyRule `json:"rules"`
}

type EvaluationTraceStep struct {
	StableRuleID string                `json:"stableRuleId"`
	Title        string                `json:"title"`
	Effect       RuntimeDecisionStatus `json:"effect"`
	Matched      bool                  `json:"matched"`
	MatchReason  string                `json:"matchReason"`
}

type PolicyEvaluationResult struct {
	Status      RuntimeDecisionStatus `json:"status"`
	MatchedRefs []string              `json:"matchedRefs"`
	Reason      string                `json:"reason"`
	Trace       []EvaluationTraceStep `json:"trace"`
	RuleCount   int                   `json:"ruleCount"`
	EvaluatedAt string                `json:"evaluatedAt"`
}

type PolicyEvaluationInput struct {
	Connector      string
	Action         string
	Domains        []string
	Rules          []PolicyRule
	Layers         []CompositionLayer
	ToolIntent     string
	PlanSummary    string
	ToolParameters map[string]any
}

const (
	statusAllow    RuntimeDecisionStatus = "ALLOW"
	statusWarn     RuntimeDecisionStatus = "WARN"
	statusEscalate RuntimeDecisionStatus = "ESCALATE"
	statusDeny     RuntimeDecisionStatus = "DENY"
)
