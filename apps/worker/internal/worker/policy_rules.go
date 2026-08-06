package worker

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Go port of the published-rule evaluator in packages/policy-schema
// (evaluateDecision, composePolicyLayers, evaluateParameterConstraints).
//
// The worker needs this because it serves delegated /api/gateway/decide
// traffic: without it the delegated path runs only the generic
// safety-threshold evaluator and an authored ESCALATE/DENY rule is recorded as
// PROCEED. The two implementations are held in step by the shared conformance
// fixtures (see policy_conformance_test.go) rather than by review alone.

// SemanticCheck mirrors the TypeScript SemanticCheck.
type SemanticCheck struct {
	ID     string                 `json:"id"`
	Prompt string                 `json:"prompt"`
	Effect *RuntimeDecisionStatus `json:"effect,omitempty"`
}

// PolicyParameterConstraint mirrors the TypeScript PolicyParameterConstraint.
type PolicyParameterConstraint struct {
	// Field is a dot-path into toolParameters, e.g. "branch.protected".
	Field    string                 `json:"field"`
	Operator string                 `json:"operator"`
	Value    any                    `json:"value"`
	Effect   *RuntimeDecisionStatus `json:"effect,omitempty"`
}

// PolicyRule is the subset of the TypeScript PolicyRuleSummary the evaluator
// reads. Unknown fields are ignored on decode, so authoring-only metadata does
// not need mirroring here.
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

// CompositionLayer is one published policy layer, ordered from least to most
// specific (e.g. ORGANIZATION before WORKSPACE).
type CompositionLayer struct {
	Scope string       `json:"scope"`
	Rules []PolicyRule `json:"rules"`
}

// EvaluationTraceStep records why each rule did or did not match.
type EvaluationTraceStep struct {
	StableRuleID string                `json:"stableRuleId"`
	Title        string                `json:"title"`
	Effect       RuntimeDecisionStatus `json:"effect"`
	Matched      bool                  `json:"matched"`
	MatchReason  string                `json:"matchReason"`
}

// PolicyEvaluationResult mirrors the TypeScript EvaluationResult.
type PolicyEvaluationResult struct {
	Status      RuntimeDecisionStatus `json:"status"`
	MatchedRefs []string              `json:"matchedRefs"`
	Reason      string                `json:"reason"`
	Trace       []EvaluationTraceStep `json:"trace"`
	RuleCount   int                   `json:"ruleCount"`
	EvaluatedAt string                `json:"evaluatedAt"`
}

// matchedPolicyRule is a rule that matched, with its effective effect after any
// semantic or parameter override.
type matchedPolicyRule struct {
	rule          PolicyRule
	effect        RuntimeDecisionStatus
	matchedPrompt string
}

// firstWithEffect returns the first matched rule carrying the given effect.
func firstWithEffect(items []matchedPolicyRule, effect RuntimeDecisionStatus) (matchedPolicyRule, bool) {
	for _, item := range items {
		if item.effect == effect {
			return item, true
		}
	}
	return matchedPolicyRule{}, false
}

// PolicyEvaluationInput is the request side of evaluatePolicyRules.
type PolicyEvaluationInput struct {
	Connector      string
	Action         string
	Domains        []string
	Rules          []PolicyRule
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

// composePolicyLayers flattens ordered layers into effective rules.
//
// Later (more specific) layers override earlier ones by stableRuleId, except
// that a rule marked immutable in an earlier layer cannot be overridden.
func composePolicyLayers(layers []CompositionLayer) (effectiveRules []PolicyRule, conflictNotes []string) {
	type entry struct {
		rule       PolicyRule
		layerScope string
	}
	// Preserve first-seen order so output ordering matches the TypeScript Map.
	index := map[string]int{}
	entries := make([]entry, 0)

	for _, layer := range layers {
		for _, rule := range layer.Rules {
			at, seen := index[rule.StableRuleID]
			if seen {
				existing := entries[at]
				if existing.rule.Immutable {
					conflictNotes = append(conflictNotes, fmt.Sprintf(
						"Conflict in %s layer: Rule %q is immutable in %s and cannot be overridden.",
						layer.Scope, rule.StableRuleID, existing.layerScope,
					))
					continue
				}
				if existing.layerScope != layer.Scope {
					conflictNotes = append(conflictNotes, fmt.Sprintf(
						"Override: %s layer has updated rule %q from %s.",
						layer.Scope, rule.StableRuleID, existing.layerScope,
					))
				}
				entries[at] = entry{rule: rule, layerScope: layer.Scope}
				continue
			}
			index[rule.StableRuleID] = len(entries)
			entries = append(entries, entry{rule: rule, layerScope: layer.Scope})
		}
	}

	effectiveRules = make([]PolicyRule, 0, len(entries))
	for _, e := range entries {
		effectiveRules = append(effectiveRules, e.rule)
	}
	return effectiveRules, conflictNotes
}

// evaluatePolicyRules is the Go equivalent of evaluateDecision.
func evaluatePolicyRules(input PolicyEvaluationInput) PolicyEvaluationResult {
	trace := make([]EvaluationTraceStep, 0, len(input.Rules))
	matchedRefs := make([]string, 0)

	matchedRules := make([]matchedPolicyRule, 0)

	for _, rule := range input.Rules {
		connectorMatch := len(rule.Connectors) == 0 || slices.Contains(rule.Connectors, input.Connector)
		actionMatch := len(rule.Actions) == 0 || actionMatches(rule.Actions, input.Action)
		domainMatch := len(rule.Domains) == 0 || len(input.Domains) == 0 ||
			intersects(rule.Domains, input.Domains)

		matched := connectorMatch && actionMatch && domainMatch

		var semanticMatched bool
		var semanticPrompt string
		var semanticOverride *RuntimeDecisionStatus
		var parameterMatched bool
		var parameterOverride *RuntimeDecisionStatus

		if matched && len(rule.SemanticChecks) > 0 {
			semanticMatched, semanticPrompt, semanticOverride = evaluateSemanticChecks(
				rule.SemanticChecks, input.ToolIntent, input.PlanSummary, input.ToolParameters,
			)
			if !semanticMatched {
				matched = false
			}
		}

		if matched && len(rule.ParameterConstraints) > 0 {
			parameterMatched, parameterOverride = evaluateParameterConstraints(
				rule.ParameterConstraints, input.ToolParameters,
			)
			if !parameterMatched {
				matched = false
			}
		}

		matchReason := "no match"
		if matched {
			parts := make([]string, 0, 4)
			if connectorMatch && len(rule.Connectors) > 0 {
				parts = append(parts, "connector="+input.Connector)
			}
			if actionMatch && len(rule.Actions) > 0 {
				parts = append(parts, "action="+input.Action)
			}
			if domainMatch && len(rule.Domains) > 0 && len(input.Domains) > 0 {
				parts = append(parts, "domain="+strings.Join(input.Domains, ","))
			}
			if semanticMatched {
				parts = append(parts, fmt.Sprintf("semantic_check=%q", semanticPrompt))
			}
			if parameterMatched {
				parts = append(parts, "parameter_constraints=matched")
			}
			if len(parts) > 0 {
				matchReason = strings.Join(parts, "; ")
			} else {
				matchReason = "wildcard match"
			}
		}

		trace = append(trace, EvaluationTraceStep{
			StableRuleID: rule.StableRuleID,
			Title:        rule.Title,
			Effect:       rule.Effect,
			Matched:      matched,
			MatchReason:  matchReason,
		})

		if !matched {
			continue
		}
		matchedRefs = append(matchedRefs, rule.StableRuleID)
		effect := rule.Effect
		if semanticOverride != nil {
			effect = *semanticOverride
		}
		if parameterOverride != nil {
			effect = *parameterOverride
		}
		matchedRules = append(matchedRules, matchedPolicyRule{
			rule:          rule,
			effect:        effect,
			matchedPrompt: semanticPrompt,
		})
	}

	status := statusAllow
	reason := "No rules matched — request is allowed by default."

	// Precedence: DENY beats ESCALATE beats WARN; otherwise the first match.
	if found, ok := firstWithEffect(matchedRules, statusDeny); ok {
		status = statusDeny
		reason = fmt.Sprintf("Denied by rule %q: %s%s",
			found.rule.StableRuleID, found.rule.Title, semanticSuffix(found.matchedPrompt))
	} else if found, ok := firstWithEffect(matchedRules, statusEscalate); ok {
		status = statusEscalate
		reason = fmt.Sprintf("Escalated by rule %q: %s%s",
			found.rule.StableRuleID, found.rule.Title, semanticSuffix(found.matchedPrompt))
	} else if found, ok := firstWithEffect(matchedRules, statusWarn); ok {
		status = statusWarn
		reason = fmt.Sprintf("Warning from rule %q: %s%s",
			found.rule.StableRuleID, found.rule.Title, semanticSuffix(found.matchedPrompt))
	} else if len(matchedRules) > 0 {
		found := matchedRules[0]
		reason = fmt.Sprintf("Allowed by rule %q: %s%s",
			found.rule.StableRuleID, found.rule.Title, semanticSuffix(found.matchedPrompt))
	}

	return PolicyEvaluationResult{
		Status:      status,
		MatchedRefs: matchedRefs,
		Reason:      reason,
		Trace:       trace,
		RuleCount:   len(input.Rules),
		EvaluatedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

func semanticSuffix(prompt string) string {
	if prompt == "" {
		return ""
	}
	return fmt.Sprintf(" (semantic check: %q)", prompt)
}

// actionMatches supports exact matches and "prefix.*" wildcards.
func actionMatches(patterns []string, action string) bool {
	for _, pattern := range patterns {
		if pattern == action {
			return true
		}
		if strings.HasSuffix(pattern, ".*") {
			if strings.HasPrefix(action, strings.TrimSuffix(pattern, "*")) {
				return true
			}
			continue
		}
		// TypeScript replaces only a trailing ".*"; a pattern without one is
		// still used as a prefix test against the raw pattern.
		if strings.HasPrefix(action, pattern) {
			return true
		}
	}
	return false
}

func intersects(left, right []string) bool {
	for _, value := range left {
		if slices.Contains(right, value) {
			return true
		}
	}
	return false
}

// evaluateParameterConstraints ANDs every constraint; all must hold for the
// rule to match. The last constraint carrying an effect wins.
func evaluateParameterConstraints(
	constraints []PolicyParameterConstraint,
	toolParameters map[string]any,
) (matched bool, effectOverride *RuntimeDecisionStatus) {
	if len(constraints) == 0 {
		return false, nil
	}
	for _, constraint := range constraints {
		actual := readDotPath(toolParameters, constraint.Field)
		if !compareConstraintValue(constraint.Operator, actual, constraint.Value) {
			return false, nil
		}
		if constraint.Effect != nil {
			effectOverride = constraint.Effect
		}
	}
	return true, effectOverride
}

func readDotPath(source map[string]any, path string) any {
	var current any = source
	for segment := range strings.SplitSeq(path, ".") {
		asMap, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = asMap[segment]
	}
	return current
}

func compareConstraintValue(operator string, actual, expected any) bool {
	switch operator {
	case "eq":
		return strictEquals(actual, expected)
	case "neq":
		return !strictEquals(actual, expected)
	case "gt", "gte", "lt", "lte":
		actualNum, actualOK := asFloat(actual)
		expectedNum, expectedOK := asFloat(expected)
		if !actualOK || !expectedOK {
			return false
		}
		switch operator {
		case "gt":
			return actualNum > expectedNum
		case "gte":
			return actualNum >= expectedNum
		case "lt":
			return actualNum < expectedNum
		default:
			return actualNum <= expectedNum
		}
	case "in", "not_in":
		list, ok := expected.([]any)
		if !ok {
			return false
		}
		found := false
		for _, candidate := range list {
			if strictEquals(actual, candidate) {
				found = true
				break
			}
		}
		if operator == "in" {
			return found
		}
		return !found
	case "contains":
		actualStr, actualOK := actual.(string)
		expectedStr, expectedOK := expected.(string)
		return actualOK && expectedOK && strings.Contains(actualStr, expectedStr)
	default:
		return false
	}
}

// strictEquals mirrors JavaScript's === for JSON-shaped values: primitives
// compare by value, and objects/arrays are never equal because JavaScript
// compares them by reference.
func strictEquals(left, right any) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if leftNum, ok := asFloat(left); ok {
		rightNum, ok := asFloat(right)
		return ok && leftNum == rightNum
	}
	switch typed := left.(type) {
	case string:
		other, ok := right.(string)
		return ok && typed == other
	case bool:
		other, ok := right.(bool)
		return ok && typed == other
	default:
		// Maps and slices: reference comparison, always false for distinct values.
		return false
	}
}

// asFloat normalises the numeric shapes JSON decoding can produce. The gateway
// handler decodes with UseNumber(), so json.Number must be handled alongside
// float64.
func asFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}
