package worker

import (
	"encoding/json"
	"regexp"
	"strings"
)

var sensitiveKeyPattern = regexp.MustCompile(`(?i)authorization|token|secret|password|credential|jwt|cookie|ssn|card|cvv|private|cert|ssh|client_id|client_secret|clientsecret|clientid|db_|\bkey\b|^key$|api_?key|apiKey|secret_?key|secretKey|private_?key|privateKey|auth_?key|authKey|access_?key|accessKey|sensitive`)
var secretKeyValPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{32,512}$`)
var secretKeyNameHeuristicPattern = regexp.MustCompile(`(?i)token|secret|key|auth`)

func sanitizeText(text *string, maxLength int) *string {
	if text == nil {
		return nil
	}
	val := strings.TrimSpace(*text)
	runes := []rune(val)
	if len(runes) > maxLength {
		truncated := string(runes[:maxLength]) + "... [Truncated]"
		return &truncated
	}
	return &val
}

func redactAndBoundParameters(params map[string]any) map[string]any {
	if params == nil {
		return nil
	}
	res := redactAndBoundValue(params, 4, 100)
	if m, ok := res.(map[string]any); ok {
		return m
	}
	return make(map[string]any)
}

func redactAndBoundValue(value any, maxDepth int, maxNodes int) any {
	nodeCount := 0

	var walk func(val any, depth int) any
	walk = func(val any, depth int) any {
		if nodeCount >= maxNodes {
			return "[Truncated: Max node limit reached]"
		}
		if depth > maxDepth {
			return "[Truncated: Max depth reached]"
		}

		nodeCount++

		if val == nil {
			return nil
		}

		switch v := val.(type) {
		case map[string]any:
			result := make(map[string]any)
			for k, child := range v {
				if nodeCount >= maxNodes {
					result[k] = "[Truncated: Max node limit reached]"
					continue
				}
				if sensitiveKeyPattern.MatchString(k) {
					result[k] = "[REDACTED]"
				} else {
					result[k] = walk(child, depth+1)
				}
			}
			return result
		case []any:
			result := make([]any, len(v))
			for i, child := range v {
				result[i] = walk(child, depth+1)
			}
			return result
		case string:
			runes := []rune(v)
			if len(runes) > 500 {
				return string(runes[:500]) + "... [Truncated]"
			}
			if strings.HasPrefix(v, "eyJ") || secretKeyValPattern.MatchString(v) {
				if secretKeyNameHeuristicPattern.MatchString(v) || len(runes) > 60 {
					return "[REDACTED (Sensitive Value Heuristic)]"
				}
			}
			return v
		case json.Number:
			return v
		default:
			return v
		}
	}

	return walk(value, 1)
}

func (p *EvidenceRequest) Sanitize() {
	if p == nil {
		return
	}
	p.ToolIntent = sanitizeText(p.ToolIntent, 1000)
	p.PlanSummary = sanitizeText(p.PlanSummary, 2000)
	if p.ToolParameters != nil {
		p.ToolParameters = redactAndBoundParameters(p.ToolParameters)
	}
	if p.RawEvidence != nil {
		p.RawEvidence = redactAndBoundParameters(p.RawEvidence)
	}
	if p.ExecutionTrace != nil {
		p.ExecutionTrace = redactAndBoundValue(p.ExecutionTrace, 6, 250)
	}
}

func sanitizeGatewayDecisionRequest(p *GatewayDecisionRequest) {
	if p == nil {
		return
	}
	p.ToolIntent = sanitizeText(p.ToolIntent, 1000)
	p.PlanSummary = sanitizeText(p.PlanSummary, 2000)
	if p.ToolParameters != nil {
		sanitized := redactAndBoundParameters(*p.ToolParameters)
		p.ToolParameters = &sanitized
	}
}
