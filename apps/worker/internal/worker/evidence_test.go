package worker

import (
	"encoding/json"
	"strings"
	"testing"
)

func validEvidence() EvidenceRequest {
	latency := 12
	return EvidenceRequest{
		DecisionID:  "dec-1",
		Environment: "production",
		RuntimeTarget: RuntimeTarget{
			Stack: "CUSTOM",
		},
		AgentID:      "agent-1",
		Connector:    "github",
		Action:       "issue.create",
		Status:       "ALLOW",
		Reason:       "allowed by policy",
		PolicyRefs:   []string{"rule-1"},
		ArtifactHash: "sha256:abc",
		PolicyContext: []RuntimePolicyContext{{
			Scope:        "WORKSPACE",
			BranchID:     "branch-1",
			RevisionID:   "revision-1",
			ArtifactHash: "sha256:abc",
		}},
		LatencyMS: &latency,
		CreatedAt: "2026-05-13T18:00:00Z",
	}
}

func TestEvidenceValidationRequiresStandardPolicyContext(t *testing.T) {
	payload := validEvidence()
	payload.PolicyRefs = nil
	payload.ArtifactHash = ""
	payload.PolicyContext = nil

	issues := payload.validate()
	if len(issues) != 3 {
		t.Fatalf("expected 3 issues, got %d: %#v", len(issues), issues)
	}
}

func TestEvidenceValidationAllowsGatewayLeniency(t *testing.T) {
	payload := validEvidence()
	payload.IngestMode = "gateway"
	payload.PolicyRefs = nil
	payload.ArtifactHash = ""
	payload.PolicyContext = nil

	if issues := payload.validate(); len(issues) != 0 {
		t.Fatalf("expected no issues, got %#v", issues)
	}
}

func TestOperationsContentHashChangesWithPayload(t *testing.T) {
	a := operationsContentHash("EVIDENCE_INGEST", "dec-1", "runtime_evidence_event", "actor-1", []byte(`{"status":"ALLOW"}`), nil)
	b := operationsContentHash("EVIDENCE_INGEST", "dec-1", "runtime_evidence_event", "actor-1", []byte(`{"status":"DENY"}`), nil)
	if a == b {
		t.Fatal("expected different hashes for different payloads")
	}
	if len(a) != len("sha256:")+64 {
		t.Fatalf("unexpected hash format: %s", a)
	}
}

func TestEvidenceRequestRoundTripIntentFields(t *testing.T) {
	inputJSON := `{
		"decisionId": "dec-intent-1",
		"environment": "production",
		"runtimeTarget": {
			"stack": "CUSTOM"
		},
		"agentId": "agent-1",
		"connector": "github",
		"action": "issue.create",
		"status": "ALLOW",
		"reason": "allowed",
		"toolIntent": "test intent",
		"planSummary": "test plan summary",
		"toolParameters": {
			"arg1": "value1"
		}
	}`

	var req EvidenceRequest
	if err := json.Unmarshal([]byte(inputJSON), &req); err != nil {
		t.Fatal(err)
	}

	if req.ToolIntent == nil || *req.ToolIntent != "test intent" {
		t.Errorf("expected ToolIntent to be 'test intent', got %v", req.ToolIntent)
	}
	if req.PlanSummary == nil || *req.PlanSummary != "test plan summary" {
		t.Errorf("expected PlanSummary to be 'test plan summary', got %v", req.PlanSummary)
	}
	if req.ToolParameters == nil || req.ToolParameters["arg1"] != "value1" {
		t.Errorf("expected ToolParameters.arg1 to be 'value1', got %v", req.ToolParameters)
	}
}

func TestEvidenceRequestSanitizationAndValidation(t *testing.T) {
	intent := strings.Repeat("a", 3000)
	summary := strings.Repeat("b", 4000)
	req := EvidenceRequest{
		ToolIntent:  &intent,
		PlanSummary: &summary,
		ToolParameters: map[string]any{
			"safe":              "value",
			"password":          "sensitive-secret-here",
			"db_password":       "another-secret",
			"sensitive_api_key": "sk-proj-key",
		},
		RawEvidence: map[string]any{
			"safe": "value",
			"headers": map[string]any{
				"authorization": "Bearer super-secret-token",
			},
		},
		ExecutionTrace: []any{
			map[string]any{
				"tool":   "http",
				"apiKey": "super-secret-api-key",
			},
		},
	}

	tooLong := strings.Repeat("x", 100001)
	invalidReq := req
	invalidReq.ToolIntent = &tooLong
	issues := invalidReq.validate()
	found := false
	for _, issue := range issues {
		if issue.Path == "toolIntent" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected toolIntent validation error for too long string")
	}

	req.Sanitize()

	if len(*req.ToolIntent) != 1000+len("... [Truncated]") {
		t.Errorf("expected ToolIntent to be truncated to 1000, got %d", len(*req.ToolIntent))
	}
	if !strings.HasSuffix(*req.ToolIntent, "... [Truncated]") {
		t.Errorf("expected ToolIntent to end with [Truncated], got %s", *req.ToolIntent)
	}

	if len(*req.PlanSummary) != 2000+len("... [Truncated]") {
		t.Errorf("expected PlanSummary to be truncated to 2000, got %d", len(*req.PlanSummary))
	}

	if req.ToolParameters["safe"] != "value" {
		t.Errorf("expected safe parameter to be untouched, got %v", req.ToolParameters["safe"])
	}
	if req.ToolParameters["password"] != "[REDACTED]" {
		t.Errorf("expected password to be redacted, got %v", req.ToolParameters["password"])
	}
	if req.ToolParameters["db_password"] != "[REDACTED]" {
		t.Errorf("expected db_password to be redacted, got %v", req.ToolParameters["db_password"])
	}
	if req.ToolParameters["sensitive_api_key"] != "[REDACTED]" {
		t.Errorf("expected sensitive_api_key to be redacted, got %v", req.ToolParameters["sensitive_api_key"])
	}
	headers, ok := req.RawEvidence["headers"].(map[string]any)
	if !ok {
		t.Fatalf("expected raw evidence headers map, got %T", req.RawEvidence["headers"])
	}
	if headers["authorization"] != "[REDACTED]" {
		t.Errorf("expected raw evidence authorization to be redacted, got %v", headers["authorization"])
	}
	trace, ok := req.ExecutionTrace.([]any)
	if !ok || len(trace) != 1 {
		t.Fatalf("expected execution trace slice, got %T", req.ExecutionTrace)
	}
	step, ok := trace[0].(map[string]any)
	if !ok {
		t.Fatalf("expected execution trace step map, got %T", trace[0])
	}
	if step["apiKey"] != "[REDACTED]" {
		t.Errorf("expected execution trace apiKey to be redacted, got %v", step["apiKey"])
	}
}
