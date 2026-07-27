package worker

import (
	"math"
	"strings"
)

func (p GatewayDecisionRequest) validate() []validationIssue {
	var issues []validationIssue
	required := map[string]string{
		"decisionId":   p.DecisionID,
		"artifactHash": p.ArtifactHash,
	}
	for path, value := range required {
		if strings.TrimSpace(value) == "" {
			issues = append(issues, validationIssue{Path: path, Message: path + " is required."})
		}
	}
	if len(p.PolicyContext) == 0 {
		issues = append(issues, validationIssue{Path: "policyContext", Message: "policyContext must include at least one valid context node."})
	}
	for i, ctx := range p.PolicyContext {
		prefix := "policyContext." + strconvI(i)
		if !validScopes[string(ctx.Scope)] {
			issues = append(issues, validationIssue{Path: prefix + ".scope", Message: "policy context scope is not supported."})
		}
		if strings.TrimSpace(ctx.BranchID) == "" {
			issues = append(issues, validationIssue{Path: prefix + ".branchId", Message: "branchId is required."})
		}
		if strings.TrimSpace(ctx.RevisionID) == "" {
			issues = append(issues, validationIssue{Path: prefix + ".revisionId", Message: "revisionId is required."})
		}
		if strings.TrimSpace(ctx.ArtifactHash) == "" {
			issues = append(issues, validationIssue{Path: prefix + ".artifactHash", Message: "artifactHash is required."})
		}
	}
	if p.Confidence != nil && (*p.Confidence < 0 || *p.Confidence > 1 || math.IsNaN(float64(*p.Confidence))) {
		issues = append(issues, validationIssue{Path: "confidence", Message: "confidence must be between 0 and 1."})
	}
	if p.AmountUsd != nil && (*p.AmountUsd < 0 || math.IsNaN(float64(*p.AmountUsd))) {
		issues = append(issues, validationIssue{Path: "amountUsd", Message: "amountUsd must be non-negative."})
	}
	if p.ContextBudget != nil && *p.ContextBudget < 0 {
		issues = append(issues, validationIssue{Path: "contextBudget", Message: "contextBudget must be non-negative."})
	}
	if p.RiskLevel != nil {
		rl := string(*p.RiskLevel)
		if rl != "LOW" && rl != "MEDIUM" && rl != "HIGH" && rl != "CRITICAL" {
			issues = append(issues, validationIssue{Path: "riskLevel", Message: "riskLevel must be LOW, MEDIUM, HIGH, or CRITICAL."})
		}
	}
	if p.ToolIntent != nil && len(*p.ToolIntent) > 100000 {
		issues = append(issues, validationIssue{Path: "toolIntent", Message: "toolIntent must be at most 100000 characters."})
	}
	if p.PlanSummary != nil && len(*p.PlanSummary) > 100000 {
		issues = append(issues, validationIssue{Path: "planSummary", Message: "planSummary must be at most 100000 characters."})
	}
	return issues
}

func (p GatewayResolveRequest) validate() []validationIssue {
	var issues []validationIssue
	if strings.TrimSpace(p.QueueID) == "" {
		issues = append(issues, validationIssue{Path: "queueId", Message: "queueId is required."})
	}
	if p.ResolutionOutcome != "PROCEED" && p.ResolutionOutcome != "ESCALATE" && p.ResolutionOutcome != "ABORT" {
		issues = append(issues, validationIssue{Path: "resolutionOutcome", Message: "resolutionOutcome must be PROCEED, ESCALATE, or ABORT."})
	}
	return issues
}

func evaluateGatewayDecision(input GatewayDecisionRequest) GatewayDecision {
	consequence := strings.ToUpper(strings.TrimSpace(derefString(input.Consequence)))
	sensitivity := strings.ToUpper(strings.TrimSpace(derefString(input.DataSensitivity)))

	if consequence == "PROHIBITED" ||
		consequence == "IRREVERSIBLE" ||
		(input.TrustScore != nil && *input.TrustScore < 0.2 && input.AmountUsd != nil && *input.AmountUsd >= 50_000) ||
		(input.TrustScore != nil && *input.TrustScore < 0.2 && sensitivity == "RESTRICTED") {
		return GatewayDecision{
			Outcome:     "ABORT",
			Reason:      firstNonEmpty(derefString(input.Reason), "Gateway aborted action due to prohibited/irreversible consequence or critically low trust under high-impact conditions."),
			RiskLevel:   "CRITICAL",
			ShouldQueue: false,
		}
	}

	if consequence == "HIGH" ||
		consequence == "CRITICAL" ||
		sensitivity == "HIGH" ||
		sensitivity == "RESTRICTED" ||
		(input.AmountUsd != nil && *input.AmountUsd >= 10_000) ||
		(input.TrustScore != nil && *input.TrustScore < 0.45) ||
		(input.Confidence != nil && *input.Confidence < 0.6) {
		slaHours := 4
		return GatewayDecision{
			Outcome:     "ESCALATE",
			Reason:      firstNonEmpty(derefString(input.Reason), "Gateway escalated action due to elevated consequence, sensitivity, confidence, trust, or monetary impact."),
			RiskLevel:   "HIGH",
			ShouldQueue: true,
			SLAHours:    &slaHours,
		}
	}

	return GatewayDecision{
		Outcome:     "PROCEED",
		Reason:      firstNonEmpty(derefString(input.Reason), "Gateway approved action under current risk and trust thresholds."),
		RiskLevel:   "LOW",
		ShouldQueue: false,
	}
}
