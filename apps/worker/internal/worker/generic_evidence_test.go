package worker

import (
	"strings"
	"testing"
)

func validGenericEvidenceCommand() genericEvidenceCommand {
	return genericEvidenceCommand{
		TenantID:          "11111111-1111-4111-8111-111111111111",
		WorkspaceID:       "22222222-2222-4222-8222-222222222222",
		IntegrationID:     "33333333-3333-4333-8333-333333333333",
		MappingRevisionID: "44444444-4444-4444-8444-444444444444",
		ServiceTokenID:    "55555555-5555-4555-8555-555555555555",
		ProviderType:      "generic_json",
		IdempotencyKey:    "source:event-1",
		ContentHash:       "sha256:" + strings.Repeat("a", 64),
		SourcePayload:     []byte(`{"event":"one"}`),
		Canonical: &genericCanonicalEvidence{
			OccurredAt:          "2026-08-11T12:00:00Z",
			Action:              "tool.call",
			EnforcementDecision: "allow",
			SourceAttributes:    []byte(`{"event":"one"}`),
		},
	}
}

func TestGenericEvidenceCommandValidation(t *testing.T) {
	command := validGenericEvidenceCommand()
	if err := command.validate(); err != nil {
		t.Fatalf("valid command rejected: %v", err)
	}

	command.ProviderType = "untrusted_provider"
	if err := command.validate(); err == nil {
		t.Fatal("unsupported provider was accepted")
	}

	command = validGenericEvidenceCommand()
	command.RejectedReason = stringPtr("mapping failed")
	if err := command.validate(); err == nil {
		t.Fatal("command with rejection and canonical event was accepted")
	}
}

func stringPtr(value string) *string { return &value }
