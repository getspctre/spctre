package worker

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestGatewayEventMatchesPublicContractFieldSet(t *testing.T) {
	typeOfEvent := reflect.TypeOf(gatewayEvent{})
	actual := make(map[string]bool, typeOfEvent.NumField())
	for i := 0; i < typeOfEvent.NumField(); i++ {
		field := typeOfEvent.Field(i)
		jsonName := strings.Split(field.Tag.Get("json"), ",")[0]
		if jsonName == "" || jsonName == "-" {
			t.Fatalf("gatewayEvent field %s must have a canonical JSON name", field.Name)
		}
		actual[jsonName] = true
	}

	canonical := map[string]bool{
		"provider": true, "gatewayEventId": true, "model": true, "agentId": true,
		"connector": true, "action": true, "toolDeclarations": true, "promptTokens": true,
		"completionTokens": true, "latencyMs": true, "costUsd": true, "eventTimestamp": true,
		"rawEvent": true,
	}
	if !reflect.DeepEqual(actual, canonical) {
		t.Fatalf("gatewayEvent fields drifted from spctre.gateway.event.v1: got %#v, want %#v", actual, canonical)
	}
}

func validGatewayDecision() GatewayDecisionRequest {
	return GatewayDecisionRequest{
		DecisionID:   "dec-1",
		ArtifactHash: "sha256:abc",
		PolicyContext: []RuntimePolicyContext{{
			Scope:        "WORKSPACE",
			BranchID:     "branch-1",
			RevisionID:   "revision-1",
			ArtifactHash: "sha256:abc",
		}},
	}
}

func TestGatewayDecisionValidationRequiresContext(t *testing.T) {
	payload := validGatewayDecision()
	payload.PolicyContext = nil

	issues := payload.validate()
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d: %#v", len(issues), issues)
	}
	if issues[0].Path != "policyContext" {
		t.Fatalf("expected policyContext issue, got %#v", issues[0])
	}
}

func TestGatewayDecisionRequestRoundTripsTenantWorkspace(t *testing.T) {
	var payload GatewayDecisionRequest
	if err := json.Unmarshal([]byte(`{"decisionId":"dec-1","tenantId":"tenant-1","workspaceId":"workspace-1","artifactHash":"sha256:abc","policyContext":[{"scope":"WORKSPACE","branchId":"branch-1","revisionId":"revision-1","artifactHash":"sha256:abc"}]}`), &payload); err != nil {
		t.Fatal(err)
	}
	if derefString(payload.TenantID) != "tenant-1" || derefString(payload.WorkspaceID) != "workspace-1" {
		t.Fatalf("expected generated request to retain tenant/workspace fields, got %#v", payload)
	}
}

func TestEvaluateGatewayDecisionOutcomes(t *testing.T) {
	low := evaluateGatewayDecision(validGatewayDecision())
	if low.Outcome != "PROCEED" || low.ShouldQueue || low.RiskLevel != "LOW" {
		t.Fatalf("unexpected low-risk result: %#v", low)
	}

	var amount float32 = 25_000.0
	escalateInput := validGatewayDecision()
	escalateInput.AmountUsd = &amount
	escalated := evaluateGatewayDecision(escalateInput)
	if escalated.Outcome != "ESCALATE" || !escalated.ShouldQueue || escalated.SLAHours == nil || *escalated.SLAHours != 4 {
		t.Fatalf("unexpected escalation result: %#v", escalated)
	}

	abortInput := validGatewayDecision()
	consequence := "PROHIBITED"
	abortInput.Consequence = &consequence
	aborted := evaluateGatewayDecision(abortInput)
	if aborted.Outcome != "ABORT" || aborted.ShouldQueue || aborted.RiskLevel != "CRITICAL" {
		t.Fatalf("unexpected abort result: %#v", aborted)
	}
}

func TestEvaluateGatewayDecisionBoundaries(t *testing.T) {
	var trust float32 = 0.45
	input := validGatewayDecision()
	input.TrustScore = &trust
	result := evaluateGatewayDecision(input)
	if result.Outcome != "PROCEED" {
		t.Fatalf("expected trust score boundary to proceed, got %#v", result)
	}

	trust = 0.44
	result = evaluateGatewayDecision(input)
	if result.Outcome != "ESCALATE" {
		t.Fatalf("expected low trust score to escalate, got %#v", result)
	}
}

func TestGatewayPayloadGuardrailRejectsOversizedToolParameters(t *testing.T) {
	parameters := map[string]interface{}{"body": strings.Repeat("x", 32_769)}
	input := validGatewayDecision()
	input.ToolParameters = &parameters
	decision, telemetry := applyGatewayPayloadGuardrail(input, GatewayDecision{Outcome: "PROCEED"})
	if decision.Outcome != "ABORT" || telemetry == nil || telemetry.PayloadOutcome != "DENY" || telemetry.PayloadHash == "" {
		t.Fatalf("expected payload guardrail abort with hash telemetry, got %#v %#v", decision, telemetry)
	}
}

func TestGatewayResolveValidation(t *testing.T) {
	issues := (GatewayResolveRequest{}).validate()
	if len(issues) != 2 {
		t.Fatalf("expected queueId and outcome issues, got %#v", issues)
	}

	valid := GatewayResolveRequest{QueueID: "q-1", ResolutionOutcome: "ABORT"}
	if issues := valid.validate(); len(issues) != 0 {
		t.Fatalf("expected valid resolve request, got %#v", issues)
	}
}

func TestNormalizeGatewayEvents(t *testing.T) {
	portkey, err := normalizePortkey(map[string]any{
		"id": "pk-1",
		"request": map[string]any{
			"tools": []any{map[string]any{"function": map[string]any{"name": "github_issue_create"}}},
		},
		"response": map[string]any{"usage": map[string]any{"prompt_tokens": float64(10), "completion_tokens": float64(5)}},
		"metadata": map[string]any{"agentId": "agent-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if portkey.Connector != "github" || portkey.Action != "github_issue_create" || portkey.AgentID != "agent-1" {
		t.Fatalf("unexpected portkey normalization: %#v", portkey)
	}

	helicone, err := normalizeHelicone(map[string]any{
		"data": map[string]any{
			"id": "hc-1",
			"request": map[string]any{
				"tools": []any{map[string]any{"name": "stripe_refund_create"}},
			},
			"properties": map[string]any{"Helicone-Session-Id": "session-1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if helicone.Connector != "stripe" || helicone.AgentID != "session-1" {
		t.Fatalf("unexpected helicone normalization: %#v", helicone)
	}

	litellm, err := normalizeLiteLLM(map[string]any{
		"call_id": "llm-1",
		"messages": []any{map[string]any{
			"tool_calls": []any{map[string]any{"function": map[string]any{"name": "kubectl_apply"}}},
		}},
		"metadata": map[string]any{"user_api_key_alias": "agent-litellm"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if litellm.Connector != "kubernetes" || litellm.AgentID != "agent-litellm" {
		t.Fatalf("unexpected litellm normalization: %#v", litellm)
	}
}

func TestEvaluateTrustGovernance(t *testing.T) {
	escalateThreshold := 0.45
	warnContext := 10_000
	escalateContext := 20_000
	policies := []trustPolicy{{
		ID: "policy-1", Name: "Runtime trust", Enabled: true,
		EscalateThreshold:        &escalateThreshold,
		ContextWarnThreshold:     &warnContext,
		ContextEscalateThreshold: &escalateContext,
	}}

	trustScore := 0.4
	result := evaluateTrustGovernance(trustEvaluateRequest{TrustScore: &trustScore}, policies)
	if result.Action != "ESCALATE" || result.RecommendedRiskLevel != "HIGH" {
		t.Fatalf("expected trust escalation, got %#v", result)
	}

	contextTokens := 12_000
	result = evaluateTrustGovernance(trustEvaluateRequest{ContextTokens: &contextTokens}, policies)
	if result.Action != "WARN" || result.RecommendedRiskLevel != "MEDIUM" {
		t.Fatalf("expected context warning, got %#v", result)
	}

	contextTokens = 25_000
	result = evaluateTrustGovernance(trustEvaluateRequest{ContextTokens: &contextTokens}, policies)
	if result.Action != "ESCALATE" || result.RecommendedRiskLevel != "HIGH" {
		t.Fatalf("expected context escalation, got %#v", result)
	}
}

func TestIsDemoTenant(t *testing.T) {
	t.Setenv("SPCTRE_DEMO_TENANT_ID", "custom-demo-tenant")
	if !isDemoTenant("custom-demo-tenant") {
		t.Fatal("expected custom-demo-tenant to be demo tenant")
	}
	if isDemoTenant("other-tenant") {
		t.Fatal("expected other-tenant to not be demo tenant")
	}

	t.Setenv("SPCTRE_DEMO_TENANT_ID", "")
	if !isDemoTenant("00000000-0000-0000-0000-000000000001") {
		t.Fatal("expected default demo UUID to be demo tenant when env is empty")
	}

	t.Setenv("SPCTRE_E2E_API_ENABLED", "true")
	if !isDemoTenant("00000000-0000-0000-0000-000000000001") {
		t.Fatal("expected E2E API flag to leave demo tenant classification unchanged")
	}
}

func TestGatewayDecisionRequestSanitization(t *testing.T) {
	intent := strings.Repeat("a", 3000)
	summary := strings.Repeat("b", 4000)
	params := map[string]any{
		"safe":              "value",
		"password":          "sensitive-secret-here",
		"db_password":       "another-secret",
		"sensitive_api_key": "sk-proj-key",
	}
	req := GatewayDecisionRequest{
		ToolIntent:     &intent,
		PlanSummary:    &summary,
		ToolParameters: &params,
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

	sanitizeGatewayDecisionRequest(&req)

	if len(*req.ToolIntent) != 1000+len("... [Truncated]") {
		t.Errorf("expected ToolIntent to be truncated to 1000, got %d", len(*req.ToolIntent))
	}
	if len(*req.PlanSummary) != 2000+len("... [Truncated]") {
		t.Errorf("expected PlanSummary to be truncated to 2000, got %d", len(*req.PlanSummary))
	}

	resParams := *req.ToolParameters
	if resParams["safe"] != "value" {
		t.Errorf("expected safe parameter to be untouched, got %v", resParams["safe"])
	}
	if resParams["password"] != "[REDACTED]" {
		t.Errorf("expected password to be redacted, got %v", resParams["password"])
	}
	if resParams["db_password"] != "[REDACTED]" {
		t.Errorf("expected db_password to be redacted, got %v", resParams["db_password"])
	}
	if resParams["sensitive_api_key"] != "[REDACTED]" {
		t.Errorf("expected sensitive_api_key to be redacted, got %v", resParams["sensitive_api_key"])
	}
}
