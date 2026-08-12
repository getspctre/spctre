package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"
)

type fakeNotificationClient struct {
	statusCode int
	request    *http.Request
	body       []byte
}

func (c *fakeNotificationClient) Do(req *http.Request) (*http.Response, error) {
	c.request = req
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, err
	}
	c.body = body
	return &http.Response{
		StatusCode: c.statusCode,
		Body:       io.NopCloser(bytes.NewReader(nil)),
	}, nil
}

func TestJobsIncludesNotificationSenderAlways(t *testing.T) {
	intervals := JobIntervals{
		Retention:      time.Hour,
		Verification:   time.Hour,
		Metrics:        time.Hour,
		EscalationSLA:  time.Hour,
		Notification:   time.Hour,
		SiemForwarder:  time.Hour,
		UsageReconcile: time.Hour,
		UsageReport:    time.Hour,
	}

	withoutWebhook := Jobs(nil, slog.Default(), intervals, NotificationConfig{})
	if len(withoutWebhook) != 8 {
		t.Fatalf("expected 8 jobs, got %d", len(withoutWebhook))
	}
	names := make(map[string]bool)
	for _, j := range withoutWebhook {
		names[j.Name] = true
	}
	for _, expected := range []string{"notification-sender", "siem-forwarder", "usage-reconcile", "usage-report"} {
		if !names[expected] {
			t.Errorf("expected job %q to be registered", expected)
		}
	}
}

func TestPostNotificationSendsWebhookPayload(t *testing.T) {
	notification := outboundNotification{
		Kind:        "critical_policy_violation",
		Severity:    "critical",
		TenantID:    "tenant-1",
		WorkspaceID: "workspace-1",
		Title:       "Production policy denial",
		Body:        "agent denied",
		SourceTable: "runtime_evidence_event",
		SourceID:    "event-1",
		Payload:     map[string]any{"decisionId": "decision-1"},
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	client := &fakeNotificationClient{statusCode: http.StatusAccepted}
	if err := postNotification(context.Background(), NotificationConfig{WebhookURL: "https://notifications.example.test/hook", Timeout: time.Second}, client, notification); err != nil {
		t.Fatal(err)
	}
	if client.request.Method != http.MethodPost {
		t.Fatalf("expected POST, got %s", client.request.Method)
	}
	if client.request.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("expected JSON content type, got %q", client.request.Header.Get("Content-Type"))
	}
	var received outboundNotification
	if err := json.Unmarshal(client.body, &received); err != nil {
		t.Fatal(err)
	}
	if received.Kind != notification.Kind || received.SourceID != notification.SourceID {
		t.Fatalf("unexpected webhook payload: %#v", received)
	}
}

func TestPostNotificationRejectsNonSuccessWebhook(t *testing.T) {
	err := postNotification(context.Background(), NotificationConfig{WebhookURL: "https://notifications.example.test/hook", Timeout: time.Second}, &fakeNotificationClient{statusCode: http.StatusBadGateway}, outboundNotification{Kind: "test"})
	if err == nil {
		t.Fatal("expected non-2xx webhook response to fail")
	}
}

func TestCustomAlertingFormatters(t *testing.T) {
	r := ruleWithIntegration{
		RuleID:          "rule-1",
		RuleName:        "Critical Slack Rule",
		IntegrationType: "SLACK",
		IntegrationURL:  "https://slack.example/hook",
		RuleTenantID:    "tenant-1",
		RuleWorkspaceID: "workspace-1",
	}

	e := evidenceEvent{
		ID:          "event-1",
		TenantID:    "tenant-1",
		WorkspaceID: "workspace-1",
		DecisionID:  "dec-123",
		AgentID:     "my-agent",
		Connector:   "google-adk",
		Action:      "read",
		Reason:      "unauthorized scope",
		CreatedAt:   time.Now(),
		RiskLevel:   "CRITICAL",
	}

	// 1. Test Slack Block Kit formatter
	body, err := formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	var slackPayload map[string]any
	if err := json.Unmarshal(body, &slackPayload); err != nil {
		t.Fatal(err)
	}
	blocks, ok := slackPayload["blocks"].([]any)
	if !ok || len(blocks) != 3 {
		t.Errorf("expected 3 blocks in Slack payload, got: %v", slackPayload)
	}

	// 2. Test Microsoft Teams Adaptive Card formatter
	r.IntegrationType = "TEAMS"
	body, err = formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	var teamsPayload map[string]any
	if err := json.Unmarshal(body, &teamsPayload); err != nil {
		t.Fatal(err)
	}
	if teamsPayload["type"] != "message" {
		t.Errorf("expected Teams card message, got: %v", teamsPayload)
	}

	// 3. Test PagerDuty Events v2 formatter
	r.IntegrationType = "PAGERDUTY"
	r.IntegrationURL = "my-routing-key"
	body, err = formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	var pdPayload map[string]any
	if err := json.Unmarshal(body, &pdPayload); err != nil {
		t.Fatal(err)
	}
	if pdPayload["routing_key"] != "my-routing-key" {
		t.Errorf("expected routing key, got: %v", pdPayload["routing_key"])
	}

	// 4. Test Webhook formatter
	r.IntegrationType = "WEBHOOK"
	body, err = formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	var webhookPayload map[string]any
	if err := json.Unmarshal(body, &webhookPayload); err != nil {
		t.Fatal(err)
	}
	if webhookPayload["ruleName"] != "Critical Slack Rule" || webhookPayload["kind"] != "custom_alerting_rule" {
		t.Errorf("unexpected Webhook format: %v", webhookPayload)
	}

	// 5. Test Splunk HEC formatter
	r.IntegrationType = "SPLUNK_HEC"
	r.IntegrationConfig = []byte(`{"token":"test-token","index":"main"}`)
	e.Status = "DENY"
	e.PolicyRefs = []string{"policy-abc", "policy-xyz"}
	e.ArtifactHash = "sha256-deadbeef"
	e.RuntimeStack = "LANGCHAIN"
	e.ApproverDid = "did:example:approver"
	body, err = formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	var hecPayload map[string]any
	if err := json.Unmarshal(body, &hecPayload); err != nil {
		t.Fatal(err)
	}
	if hecPayload["sourcetype"] != "spctre:decision" {
		t.Errorf("expected sourcetype spctre:decision, got %v", hecPayload["sourcetype"])
	}
	if hecPayload["index"] != "main" {
		t.Errorf("expected index main, got %v", hecPayload["index"])
	}
	hecEvent, ok := hecPayload["event"].(map[string]any)
	if !ok {
		t.Fatalf("expected event object in HEC payload, got: %T", hecPayload["event"])
	}
	if hecEvent["decision"] != "DENY" {
		t.Errorf("expected decision DENY, got %v", hecEvent["decision"])
	}
	if hecEvent["agtBundleHash"] != "sha256-deadbeef" {
		t.Errorf("expected agtBundleHash sha256-deadbeef, got %v", hecEvent["agtBundleHash"])
	}
	if hecEvent["runtimeTarget"] != "LANGCHAIN" {
		t.Errorf("expected runtimeTarget LANGCHAIN, got %v", hecEvent["runtimeTarget"])
	}

	// 6. Test Sentinel formatter
	r.IntegrationType = "SENTINEL"
	r.IntegrationURL = "00000000-0000-0000-0000-000000000000"
	r.IntegrationConfig = []byte(`{"primaryKey":"dGVzdC1rZXk=","logType":"SpctrePolicyEvent"}`)
	body, err = formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	var sentinelPayload []map[string]any
	if err := json.Unmarshal(body, &sentinelPayload); err != nil {
		t.Fatal(err)
	}
	if len(sentinelPayload) != 1 {
		t.Fatalf("expected 1 Sentinel event, got %d", len(sentinelPayload))
	}
	if sentinelPayload[0]["Decision"] != "DENY" {
		t.Errorf("expected Decision DENY, got %v", sentinelPayload[0]["Decision"])
	}
	if sentinelPayload[0]["AgtBundleHash"] != "sha256-deadbeef" {
		t.Errorf("expected AgtBundleHash sha256-deadbeef, got %v", sentinelPayload[0]["AgtBundleHash"])
	}
}

// Untrusted evidence fields (reason/agentId/etc.) rendered into a Slack mrkdwn
// block must have Slack's special characters escaped so they cannot inject Slack
// link syntax (`<url|text>`). See threat-model OWASP audit, finding 4.
func TestSlackFormatterEscapesUntrustedFields(t *testing.T) {
	r := ruleWithIntegration{
		RuleName:        "Rule <b>",
		IntegrationType: "SLACK",
		IntegrationURL:  "https://slack.example/hook",
	}
	e := evidenceEvent{
		AgentID:     "agent<x>",
		Connector:   "conn",
		Action:      "read",
		Reason:      "scope <https://evil.example|click here> & more",
		TenantID:    "tenant-1",
		WorkspaceID: "workspace-1",
		DecisionID:  "dec-1",
		RiskLevel:   "CRITICAL",
		CreatedAt:   time.Now(),
	}
	body, err := formatPayload(r, e)
	if err != nil {
		t.Fatal(err)
	}
	// Decode the payload and inspect the mrkdwn section text as Slack would
	// receive it. The untrusted fields must arrive with &, <, > escaped so Slack
	// cannot render injected link syntax.
	var payload struct {
		Blocks []struct {
			Text struct {
				Text string `json:"text"`
			} `json:"text"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Blocks) < 2 {
		t.Fatalf("expected at least 2 blocks, got %d", len(payload.Blocks))
	}
	sectionText := payload.Blocks[1].Text.Text
	if strings.Contains(sectionText, "<https://evil.example|click here>") {
		t.Errorf("Slack mrkdwn leaked unescaped link syntax: %s", sectionText)
	}
	if !strings.Contains(sectionText, "&lt;https://evil.example|click here&gt;") {
		t.Errorf("expected escaped reason in Slack mrkdwn, got: %s", sectionText)
	}
	if !strings.Contains(sectionText, "agent&lt;x&gt;") {
		t.Errorf("expected escaped agentId in Slack mrkdwn, got: %s", sectionText)
	}
}

func TestSiemForwarderBatchFormats(t *testing.T) {
	e := evidenceEvent{
		ID:           "ev-001",
		TenantID:     "tenant-1",
		WorkspaceID:  "ws-1",
		DecisionID:   "dec-456",
		AgentID:      "my-agent",
		Connector:    "github",
		Action:       "push",
		Reason:       "policy: no direct push to main",
		Status:       "DENY",
		RiskLevel:    "HIGH",
		PolicyRefs:   []string{"pol-a", "pol-b"},
		ArtifactHash: "sha256-abc123",
		RuntimeStack: "OPENAI_AGENTS",
		ApproverDid:  "did:example:reviewer",
		CreatedAt:    time.Now(),
	}

	// 1. buildSiemEventPayload includes required fields
	payload := buildSiemEventPayload(e)
	if payload["decision"] != "DENY" {
		t.Errorf("expected decision DENY, got %v", payload["decision"])
	}
	if payload["agtBundleHash"] != "sha256-abc123" {
		t.Errorf("expected agtBundleHash sha256-abc123, got %v", payload["agtBundleHash"])
	}
	if payload["runtimeTarget"] != "OPENAI_AGENTS" {
		t.Errorf("expected runtimeTarget OPENAI_AGENTS, got %v", payload["runtimeTarget"])
	}
	refs, ok := payload["policyRefs"].([]string)
	if !ok || len(refs) != 2 {
		t.Errorf("expected policyRefs []string with 2 entries, got %T %v", payload["policyRefs"], payload["policyRefs"])
	}

	// 2. sendSplunkHecBatch sends newline-delimited HEC JSON with correct auth header
	splunkClient := &fakeNotificationClient{statusCode: http.StatusOK}
	stream := siemStream{
		ID:              "stream-1",
		TenantID:        "tenant-1",
		WorkspaceID:     "ws-1",
		Type:            "SPLUNK_HEC",
		URL:             "https://splunk.example.com:8088/services/collector/event",
		Config:          []byte(`{}`),
		CredentialsJSON: `{"token":"test-hec-token"}`,
	}
	if err := sendSplunkHecBatch(context.Background(), splunkClient, stream, []evidenceEvent{e}); err != nil {
		t.Fatal(err)
	}
	authHeader := splunkClient.request.Header.Get("Authorization")
	if authHeader != "Splunk test-hec-token" {
		t.Errorf("expected Authorization: Splunk test-hec-token, got %q", authHeader)
	}
	// Body should be newline-delimited JSON — parse first line
	firstLine := bytes.SplitN(splunkClient.body, []byte("\n"), 2)[0]
	var hecEntry map[string]any
	if err := json.Unmarshal(firstLine, &hecEntry); err != nil {
		t.Fatalf("HEC body first line is not valid JSON: %v", err)
	}
	if hecEntry["sourcetype"] != "spctre:decision" {
		t.Errorf("expected sourcetype spctre:decision, got %v", hecEntry["sourcetype"])
	}
	hecEvent, ok := hecEntry["event"].(map[string]any)
	if !ok {
		t.Fatalf("expected event object in HEC entry")
	}
	if hecEvent["decision"] != "DENY" {
		t.Errorf("expected event.decision DENY, got %v", hecEvent["decision"])
	}

	// 3. sendToSentinel sets the correct auth and Log-Type headers
	sentinelClient := &fakeNotificationClient{statusCode: http.StatusOK}
	body := []byte(`[{"Decision":"DENY"}]`)
	// Use a valid base64-encoded key (arbitrary bytes)
	primaryKey := "dGVzdC1rZXk=" // base64("test-key")
	if err := sendToSentinel(context.Background(), sentinelClient, "00000000-0000-0000-0000-000000000000", primaryKey, "SpctrePolicyEvent", body); err != nil {
		t.Fatal(err)
	}
	logType := sentinelClient.request.Header.Get("Log-Type")
	if logType != "SpctrePolicyEvent" {
		t.Errorf("expected Log-Type SpctrePolicyEvent, got %q", logType)
	}
	authH := sentinelClient.request.Header.Get("Authorization")
	if len(authH) == 0 || authH[:9] != "SharedKey" {
		t.Errorf("expected SharedKey authorization header, got %q", authH)
	}
	if sentinelClient.request.Header.Get("x-ms-date") == "" {
		t.Error("expected x-ms-date header to be set")
	}
}

func TestSiemForwarderRejectsInvalidProviderStateBeforeHTTP(t *testing.T) {
	e := evidenceEvent{
		ID:          "ev-001",
		TenantID:    "tenant-1",
		WorkspaceID: "ws-1",
		DecisionID:  "dec-456",
		Status:      "DENY",
		CreatedAt:   time.Now(),
	}

	t.Run("splunk invalid config", func(t *testing.T) {
		client := &fakeNotificationClient{statusCode: http.StatusOK}
		stream := siemStream{
			Type:            "SPLUNK_HEC",
			URL:             "https://splunk.example.test/services/collector/event",
			Config:          []byte(`{"index":`),
			CredentialsJSON: `{"token":"test-token"}`,
		}
		if err := sendSplunkHecBatch(context.Background(), client, stream, []evidenceEvent{e}); err == nil {
			t.Fatal("expected invalid Splunk config to fail")
		}
		if client.request != nil {
			t.Fatal("invalid Splunk config should fail before HTTP delivery")
		}
	})

	t.Run("splunk invalid credentials", func(t *testing.T) {
		client := &fakeNotificationClient{statusCode: http.StatusOK}
		stream := siemStream{
			Type:            "SPLUNK_HEC",
			URL:             "https://splunk.example.test/services/collector/event",
			Config:          []byte(`{"index":"main"}`),
			CredentialsJSON: `{"token":`,
		}
		if err := sendSplunkHecBatch(context.Background(), client, stream, []evidenceEvent{e}); err == nil {
			t.Fatal("expected invalid Splunk credentials to fail")
		}
		if client.request != nil {
			t.Fatal("invalid Splunk credentials should fail before HTTP delivery")
		}
	})

	t.Run("sentinel missing primary key", func(t *testing.T) {
		client := &fakeNotificationClient{statusCode: http.StatusOK}
		stream := siemStream{
			Type:            "SENTINEL",
			URL:             "00000000-0000-0000-0000-000000000000",
			Config:          []byte(`{"logType":"SpctrePolicyEvent"}`),
			CredentialsJSON: `{}`,
		}
		if err := sendSentinelBatch(context.Background(), client, stream, []evidenceEvent{e}); err == nil {
			t.Fatal("expected missing Sentinel primary key to fail")
		}
		if client.request != nil {
			t.Fatal("missing Sentinel credentials should fail before HTTP delivery")
		}
	})

	t.Run("sentinel invalid primary key", func(t *testing.T) {
		client := &fakeNotificationClient{statusCode: http.StatusOK}
		stream := siemStream{
			Type:            "SENTINEL",
			URL:             "00000000-0000-0000-0000-000000000000",
			Config:          []byte(`{"logType":"SpctrePolicyEvent"}`),
			CredentialsJSON: `{"primaryKey":"not-base64"}`,
		}
		if err := sendSentinelBatch(context.Background(), client, stream, []evidenceEvent{e}); err == nil {
			t.Fatal("expected invalid Sentinel primary key to fail")
		}
		if client.request != nil {
			t.Fatal("invalid Sentinel primary key should fail before HTTP delivery")
		}
	})
}

func TestSiemForwarderProviderHTTPFailuresAreReturned(t *testing.T) {
	e := evidenceEvent{
		ID:          "ev-001",
		TenantID:    "tenant-1",
		WorkspaceID: "ws-1",
		DecisionID:  "dec-456",
		Status:      "DENY",
		CreatedAt:   time.Now(),
	}

	client := &fakeNotificationClient{statusCode: http.StatusTooManyRequests}
	stream := siemStream{
		Type:            "SPLUNK_HEC",
		URL:             "https://splunk.example.test/services/collector/event",
		Config:          []byte(`{"index":"main"}`),
		CredentialsJSON: `{"token":"test-token"}`,
	}
	err := sendSplunkHecBatch(context.Background(), client, stream, []evidenceEvent{e})
	if err == nil {
		t.Fatal("expected non-2xx Splunk response to fail")
	}
	var statusErr *httpStatusError
	if !errors.As(err, &statusErr) {
		t.Fatalf("expected *httpStatusError, got %T: %v", err, err)
	}
	if client.request == nil {
		t.Fatal("expected Splunk HTTP request to be attempted")
	}
}

func TestSentinelBatchBuildsCollectorPayloadFromSiemEvents(t *testing.T) {
	e := evidenceEvent{
		ID:           "ev-001",
		TenantID:     "tenant-1",
		WorkspaceID:  "ws-1",
		DecisionID:   "dec-456",
		AgentID:      "my-agent",
		Connector:    "github",
		Action:       "push",
		Reason:       "policy: no direct push to main",
		Status:       "DENY",
		RiskLevel:    "HIGH",
		PolicyRefs:   []string{"pol-a", "pol-b"},
		ArtifactHash: "sha256-abc123",
		RuntimeStack: "OPENAI_AGENTS",
		ApproverDid:  "did:example:reviewer",
		CreatedAt:    time.Now(),
	}

	client := &fakeNotificationClient{statusCode: http.StatusOK}
	stream := siemStream{
		Type:            "SENTINEL",
		URL:             "00000000-0000-0000-0000-000000000000",
		Config:          []byte(`{"logType":"SpctrePolicyEvent"}`),
		CredentialsJSON: `{"primaryKey":"dGVzdC1rZXk="}`,
	}
	if err := sendSentinelBatch(context.Background(), client, stream, []evidenceEvent{e}); err != nil {
		t.Fatal(err)
	}
	if client.request == nil {
		t.Fatal("expected Sentinel HTTP request")
	}
	if got := client.request.URL.Host; got != "00000000-0000-0000-0000-000000000000.ods.opinsights.azure.com" {
		t.Fatalf("unexpected Sentinel host: %s", got)
	}
	if got := client.request.Header.Get("Log-Type"); got != "SpctrePolicyEvent" {
		t.Fatalf("expected Log-Type SpctrePolicyEvent, got %q", got)
	}

	var records []map[string]any
	if err := json.Unmarshal(client.body, &records); err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("expected one Sentinel record, got %d", len(records))
	}
	if records[0]["decision"] != "DENY" {
		t.Fatalf("expected decision DENY, got %v", records[0]["decision"])
	}
	if records[0]["agtBundleHash"] != "sha256-abc123" {
		t.Fatalf("expected agtBundleHash sha256-abc123, got %v", records[0]["agtBundleHash"])
	}
}

func TestRiskLevelComparison(t *testing.T) {
	if riskLevelToInt("CRITICAL") != 4 {
		t.Errorf("expected CRITICAL to be 4")
	}
	if riskLevelToInt("HIGH") != 3 {
		t.Errorf("expected HIGH to be 3")
	}
	if riskLevelToInt("MEDIUM") != 2 {
		t.Errorf("expected MEDIUM to be 2")
	}
	if riskLevelToInt("LOW") != 1 {
		t.Errorf("expected LOW to be 1")
	}
	if riskLevelToInt("INVALID") != 0 {
		t.Errorf("expected unknown to be 0")
	}

	if riskToPagerDutySeverity("CRITICAL") != "critical" {
		t.Errorf("expected critical")
	}
	if riskToPagerDutySeverity("HIGH") != "error" {
		t.Errorf("expected error")
	}
	if riskToPagerDutySeverity("MEDIUM") != "warning" {
		t.Errorf("expected warning")
	}
	if riskToPagerDutySeverity("LOW") != "info" {
		t.Errorf("expected info")
	}
}
