package worker

import (
	"strings"
	"testing"
)

func TestResolvePagerDutyRouting(t *testing.T) {
	cases := []struct {
		name         string
		url          string
		config       string
		wantRouting  string
		wantEndpoint string
	}{
		{
			name:         "bare routing key routes to public enqueue endpoint",
			url:          "R0UT1NGK3Y",
			wantRouting:  "R0UT1NGK3Y",
			wantEndpoint: "https://events.pagerduty.com/v2/enqueue",
		},
		{
			name:         "explicit config routing key wins and posts to configured url",
			url:          "https://events.pagerduty.com/v2/enqueue",
			config:       `{"routingKey":"CONFIGKEY"}`,
			wantRouting:  "CONFIGKEY",
			wantEndpoint: "https://events.pagerduty.com/v2/enqueue",
		},
		{
			name:         "http url used as routing key falls back to default",
			url:          "https://events.pagerduty.com/v2/enqueue",
			wantRouting:  "default",
			wantEndpoint: "https://events.pagerduty.com/v2/enqueue",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			routing, endpoint := resolvePagerDutyRouting(tc.url, []byte(tc.config))
			if routing != tc.wantRouting {
				t.Errorf("routing = %q, want %q", routing, tc.wantRouting)
			}
			if endpoint != tc.wantEndpoint {
				t.Errorf("endpoint = %q, want %q", endpoint, tc.wantEndpoint)
			}
		})
	}
}

// Agent-controlled escalation fields (reason, toolIntent, planSummary) rendered
// into the Slack mrkdwn block must have Slack's special characters escaped so
// they cannot inject link syntax (`<url|text>`) — the same guarantee the
// custom-alerting formatter provides. See threat-model OWASP audit, finding 4.
func TestEscalationSlackPayloadEscapesUntrustedFields(t *testing.T) {
	toolIntent := "exfil <script>"
	summary, details := formatEscalationMessage(GoEscalationAlertContext{
		DecisionID: "dec-1",
		Connector:  "conn",
		Action:     "read",
		RiskLevel:  "CRITICAL",
		Reason:     "scope <https://evil.example|click here> & more",
		ToolIntent: &toolIntent,
		SLADueAt:   "2026-07-04T00:00:00Z",
	})
	payload := escalationSlackPayload(summary, details)

	blocks, ok := payload["blocks"].([]any)
	if !ok || len(blocks) < 2 {
		t.Fatalf("expected at least 2 blocks, got %v", payload["blocks"])
	}
	section, ok := blocks[1].(map[string]any)["text"].(map[string]any)
	if !ok {
		t.Fatal("section text missing")
	}
	sectionText, _ := section["text"].(string)
	if strings.Contains(sectionText, "<https://evil.example|click here>") {
		t.Errorf("Slack mrkdwn leaked unescaped link syntax: %s", sectionText)
	}
	if !strings.Contains(sectionText, "&lt;https://evil.example|click here&gt;") {
		t.Errorf("expected escaped reason in Slack mrkdwn, got: %s", sectionText)
	}
	if !strings.Contains(sectionText, "exfil &lt;script&gt;") {
		t.Errorf("expected escaped tool intent in Slack mrkdwn, got: %s", sectionText)
	}
	if topText, _ := payload["text"].(string); strings.Contains(topText, "<") && !strings.Contains(topText, "&lt;") {
		t.Errorf("summary text leaked unescaped markup: %s", topText)
	}
}

// Teams MessageCard text renders markdown, so agent-controlled escalation
// fields must have link syntax escaped — the Slack path alone being escaped
// left `[text](url)` injection open in the Teams escalation card.
func TestEscalationTeamsPayloadEscapesUntrustedFields(t *testing.T) {
	toolIntent := "exfil [data]"
	summary, details := formatEscalationMessage(GoEscalationAlertContext{
		DecisionID: "dec-1",
		Connector:  "conn",
		Action:     "read",
		RiskLevel:  "CRITICAL",
		Reason:     "scope [click here](https://evil.example) & more",
		ToolIntent: &toolIntent,
		SLADueAt:   "2026-07-04T00:00:00Z",
	})
	payload := escalationTeamsPayload(summary, details, GoEscalationAlertContext{RiskLevel: "CRITICAL"})

	sections, ok := payload["sections"].([]any)
	if !ok || len(sections) < 1 {
		t.Fatalf("expected at least 1 section, got %v", payload["sections"])
	}
	sectionText, _ := sections[0].(map[string]any)["text"].(string)
	if strings.Contains(sectionText, "[click here](https://evil.example)") {
		t.Errorf("Teams markdown leaked unescaped link syntax: %s", sectionText)
	}
	if !strings.Contains(sectionText, `\[click here\](https://evil.example)`) {
		t.Errorf("expected escaped reason in Teams markdown, got: %s", sectionText)
	}
	if !strings.Contains(sectionText, `exfil \[data\]`) {
		t.Errorf("expected escaped tool intent in Teams markdown, got: %s", sectionText)
	}
	// Our own field labels must keep their bold formatting after escaping.
	if !strings.Contains(sectionText, "**Reason**") {
		t.Errorf("expected our own markdown formatting to survive escaping, got: %s", sectionText)
	}
}

func TestEscalationPagerDutyPayloadUsesSharedRouting(t *testing.T) {
	payload, endpoint := escalationPagerDutyPayload("summary", "R0UT1NGK3Y", nil, GoEscalationAlertContext{
		DecisionID: "d1",
		Connector:  "github",
		RiskLevel:  "CRITICAL",
	})
	if endpoint != "https://events.pagerduty.com/v2/enqueue" {
		t.Fatalf("endpoint = %q", endpoint)
	}
	if payload["routing_key"] != "R0UT1NGK3Y" {
		t.Errorf("routing_key = %v", payload["routing_key"])
	}
	inner, ok := payload["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload.payload missing")
	}
	if inner["severity"] != "critical" {
		t.Errorf("severity = %v, want critical", inner["severity"])
	}
}
