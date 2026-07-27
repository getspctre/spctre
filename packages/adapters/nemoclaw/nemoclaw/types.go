package nemoclaw

import (
	"crypto/rand"
	"fmt"
	"maps"
	"time"
)

// SandboxEvent is a structured ingest event emitted by NemoClaw when a sandboxed
// agent process performs a notable OS-level action. NemoClaw operates at L3/L4;
// this event bridges that infrastructure layer into Spctre's evidence model.
type SandboxEvent struct {
	// EventType is the NemoClaw-assigned event category (e.g. "SANDBOX_ACTION").
	EventType string `json:"eventType"`

	AgentID     string `json:"agentId"`
	TenantID    string `json:"tenantId"`
	WorkspaceID string `json:"workspaceId"`
	SandboxName string `json:"sandboxName"`

	// Environment is the deployment environment ("production", "staging", etc.).
	// Defaults to "production" when empty.
	Environment string `json:"environment,omitempty"`

	// Layer is always "INFRASTRUCTURE" for NemoClaw events.
	Layer string `json:"layer"`

	// ActionKind describes the OS-level operation: "file_write", "network_call", "subprocess".
	ActionKind string `json:"actionKind"`

	// ResourcePath is the file path, URL, or executable that was acted upon.
	ResourcePath string `json:"resourcePath"`

	// Outcome is "allowed" or "blocked" as determined by the NemoClaw sandbox policy.
	Outcome string `json:"outcome"`

	// PolicyRef is the NemoClaw policy identifier that produced this outcome.
	PolicyRef string `json:"policyRef"`

	// RawPayload carries additional context from the NemoClaw event envelope.
	RawPayload map[string]any `json:"rawPayload,omitempty"`

	EmittedAt time.Time `json:"emittedAt"`
}

// EvidenceRecord is the Spctre-shaped payload produced by ToEvidenceRecord.
type EvidenceRecord struct {
	DecisionID    string         `json:"decisionId"`
	AgentID       string         `json:"agentId"`
	TenantID      string         `json:"tenantId"`
	WorkspaceID   string         `json:"workspaceId"`
	Environment   string         `json:"environment"`
	Connector     string         `json:"connector"`
	Action        string         `json:"action"`
	Status        string         `json:"status"`
	Reason        string         `json:"reason"`
	IngestMode    string         `json:"ingestMode"`
	PolicyRefs    []string       `json:"policyRefs,omitempty"`
	RuntimeTarget runtimeTarget  `json:"runtimeTarget"`
	Layer         string         `json:"layer"`
	RawEvidence   map[string]any `json:"rawEvidence,omitempty"`
	CreatedAt     string         `json:"createdAt"`
}

type runtimeTarget struct {
	Stack       string `json:"stack"`
	SandboxName string `json:"sandboxName,omitempty"`
}

// ToEvidenceRecord maps the sandbox event to the Spctre evidence shape.
// runtimeTarget.stack is always "NEMOCLAW"; layer is always "sandbox".
func (e SandboxEvent) ToEvidenceRecord() EvidenceRecord {
	status := "ALLOW"
	reason := "Allowed by NemoClaw sandbox policy."
	if e.Outcome == "blocked" {
		status = "DENY"
		reason = "Blocked by NemoClaw sandbox policy."
	}

	var policyRefs []string
	if e.PolicyRef != "" {
		policyRefs = []string{e.PolicyRef}
	}

	raw := make(map[string]any, len(e.RawPayload)+3)
	maps.Copy(raw, e.RawPayload)
	raw["eventType"] = e.EventType
	raw["actionKind"] = e.ActionKind
	raw["resourcePath"] = e.ResourcePath

	env := e.Environment
	if env == "" {
		env = "production"
	}

	connector := e.SandboxName
	if connector == "" {
		connector = "nemoclaw"
	}

	return EvidenceRecord{
		DecisionID:  newDecisionID(),
		AgentID:     e.AgentID,
		TenantID:    e.TenantID,
		WorkspaceID: e.WorkspaceID,
		Environment: env,
		Connector:   connector,
		Action:      e.ActionKind,
		Status:      status,
		Reason:      reason,
		IngestMode:  "gateway",
		PolicyRefs:  policyRefs,
		RuntimeTarget: runtimeTarget{
			Stack:       "NEMOCLAW",
			SandboxName: e.SandboxName,
		},
		Layer:       "sandbox",
		RawEvidence: raw,
		CreatedAt:   e.EmittedAt.UTC().Format(time.RFC3339),
	}
}

func newDecisionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("nemoclaw-%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("nemoclaw-%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
