package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// genericEvidenceCommand is deliberately an internal, integration-bound
// command rather than a public receiver contract. The web receiver owns
// provider decoding and declarative mapping; the worker owns durable writes.
// Rechecking every binding here prevents a compromised web process from using
// this endpoint to write evidence into an arbitrary tenant or integration.
type genericEvidenceCommand struct {
	TenantID          string                    `json:"tenantId"`
	WorkspaceID       string                    `json:"workspaceId"`
	IntegrationID     string                    `json:"integrationId"`
	MappingRevisionID string                    `json:"mappingRevisionId"`
	ServiceTokenID    string                    `json:"serviceTokenId"`
	ProviderType      string                    `json:"providerType"`
	ActorID           string                    `json:"actorId"`
	SourceEventID     *string                   `json:"sourceEventId"`
	IdempotencyKey    string                    `json:"idempotencyKey"`
	ContentHash       string                    `json:"contentHash"`
	SourcePayload     json.RawMessage           `json:"sourcePayload"`
	RejectedReason    *string                   `json:"rejectedReason"`
	Canonical         *genericCanonicalEvidence `json:"canonical"`
}

type genericCanonicalEvidence struct {
	SourceEventID         *string         `json:"sourceEventId"`
	OccurredAt            string          `json:"occurredAt"`
	PrincipalID           *string         `json:"principalId"`
	AgentExternalID       *string         `json:"agentExternalId"`
	Action                string          `json:"action"`
	TargetResource        *string         `json:"targetResource"`
	PolicyReference       *string         `json:"policyReference"`
	Environment           *string         `json:"environment"`
	EnforcementDecision   string          `json:"enforcementDecision"`
	CorrelationConfidence float64         `json:"correlationConfidence"`
	Unresolved            bool            `json:"unresolved"`
	SourceAttributes      json.RawMessage `json:"sourceAttributes"`
}

type genericEvidenceResponse struct {
	Outcome          string  `json:"outcome"`
	SourceRecordID   string  `json:"sourceRecordId,omitempty"`
	CanonicalEventID string  `json:"canonicalEventId,omitempty"`
	Reason           string  `json:"reason,omitempty"`
	Meta             APIMeta `json:"meta"`
}

func (s *Server) handleGenericEvidence(w http.ResponseWriter, r *http.Request) {
	tid := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", tid, nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, tid) {
		return
	}

	var command genericEvidenceCommand
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&command); err != nil {
		writeError(w, http.StatusBadRequest, "Internal generic evidence command must be JSON.", tid, nil)
		return
	}
	if err := command.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), tid, nil)
		return
	}

	result, status, err := s.persistGenericEvidence(r.Context(), command)
	if err != nil {
		if errors.Is(err, errGenericEvidenceBinding) {
			writeError(w, http.StatusForbidden, "Generic evidence integration binding is invalid.", tid, nil)
			return
		}
		s.logger.Error("generic evidence persistence failed", "error", err, "integration_id", command.IntegrationID)
		writeError(w, http.StatusInternalServerError, "Service temporarily unavailable.", tid, nil)
		return
	}
	result.Meta = makeMeta(tid)
	writeJSON(w, status, result)
}

var errGenericEvidenceBinding = errors.New("generic evidence integration binding is invalid")

func (c genericEvidenceCommand) validate() error {
	for _, value := range []string{c.TenantID, c.WorkspaceID, c.IntegrationID, c.MappingRevisionID, c.ServiceTokenID} {
		if !uuidRE.MatchString(value) {
			return errors.New("Generic evidence command contains an invalid identifier.")
		}
	}
	if !validGenericProvider(c.ProviderType) {
		return errors.New("Generic evidence command contains an unsupported provider type.")
	}
	if !strings.HasPrefix(c.ContentHash, "sha256:") || len(c.ContentHash) != len("sha256:")+64 {
		return errors.New("Generic evidence command contains an invalid content hash.")
	}
	if strings.TrimSpace(c.IdempotencyKey) == "" || !json.Valid(c.SourcePayload) {
		return errors.New("Generic evidence command is missing a valid source record.")
	}
	if c.RejectedReason != nil && c.Canonical != nil {
		return errors.New("Generic evidence command cannot be rejected and canonical at once.")
	}
	if c.RejectedReason == nil && c.Canonical == nil {
		return errors.New("Generic evidence command must contain a canonical event or rejection reason.")
	}
	if c.Canonical != nil {
		return c.Canonical.validate()
	}
	return nil
}

func (c genericCanonicalEvidence) validate() error {
	if strings.TrimSpace(c.Action) == "" || !validEvidenceDecision(c.EnforcementDecision) {
		return errors.New("Generic canonical evidence contains invalid required fields.")
	}
	if _, err := time.Parse(time.RFC3339, c.OccurredAt); err != nil {
		return errors.New("Generic canonical evidence contains an invalid occurrence time.")
	}
	if !json.Valid(c.SourceAttributes) {
		return errors.New("Generic canonical evidence contains invalid source attributes.")
	}
	return nil
}

func validGenericProvider(provider string) bool {
	switch provider {
	case "generic_json", "generic_ndjson", "cloudevents", "otlp_logs", "bedrock_agentcore", "docker_ai_governance", "langsmith":
		return true
	default:
		return false
	}
}

func validEvidenceDecision(decision string) bool {
	switch decision {
	case "allow", "deny", "escalate", "observe":
		return true
	default:
		return false
	}
}

func (s *Server) persistGenericEvidence(ctx context.Context, command genericEvidenceCommand) (genericEvidenceResponse, int, error) {
	tx, err := s.beginTenantTx(ctx, command.TenantID)
	if err != nil {
		return genericEvidenceResponse{}, 0, err
	}
	defer s.rollbackAfterFailure(ctx, tx, "persist_generic_evidence")

	var verifiedWorkspace string
	var verifiedActor string
	err = tx.QueryRow(ctx, `
		SELECT integration.workspace_id::text, token.principal_id::text
		FROM evidence_ingest_integration integration
		JOIN evidence_ingest_mapping_revision mapping
		  ON mapping.id = $2::uuid
		 AND mapping.integration_id = integration.id
		 AND mapping.activated_at IS NOT NULL
		JOIN service_token token ON token.id = integration.service_token_id
		WHERE integration.id = $1::uuid
		  AND integration.tenant_id = $3::uuid
		  AND integration.service_token_id = $4::uuid
		  AND integration.provider_type = $5
		  AND integration.active = true
	`, command.IntegrationID, command.MappingRevisionID, command.TenantID, command.ServiceTokenID, command.ProviderType).Scan(&verifiedWorkspace, &verifiedActor)
	if errors.Is(err, pgx.ErrNoRows) || verifiedWorkspace != command.WorkspaceID || verifiedActor != command.ActorID {
		return genericEvidenceResponse{}, 0, errGenericEvidenceBinding
	}
	if err != nil {
		return genericEvidenceResponse{}, 0, err
	}

	var sourceRecordID string
	err = tx.QueryRow(ctx, `
		INSERT INTO evidence_source_record (
			tenant_id, integration_id, mapping_revision_id, source_event_id,
			idempotency_key, content_hash, source_payload
		) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)
		ON CONFLICT (tenant_id, integration_id, idempotency_key) DO NOTHING
		RETURNING id::text
	`, command.TenantID, command.IntegrationID, command.MappingRevisionID, command.SourceEventID,
		command.IdempotencyKey, command.ContentHash, string(command.SourcePayload)).Scan(&sourceRecordID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.Commit(ctx); err != nil {
			return genericEvidenceResponse{}, 0, err
		}
		return genericEvidenceResponse{Outcome: "duplicate"}, http.StatusOK, nil
	}
	if err != nil {
		return genericEvidenceResponse{}, 0, err
	}

	if command.RejectedReason != nil {
		if _, err := tx.Exec(ctx, `UPDATE evidence_source_record SET rejected_reason = $2 WHERE id = $1::uuid`, sourceRecordID, *command.RejectedReason); err != nil {
			return genericEvidenceResponse{}, 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return genericEvidenceResponse{}, 0, err
		}
		return genericEvidenceResponse{Outcome: "rejected", SourceRecordID: sourceRecordID, Reason: *command.RejectedReason}, http.StatusAccepted, nil
	}

	canonical := command.Canonical
	canonicalAgentID, err := resolveGenericEvidenceAgent(ctx, tx, command, canonical.AgentExternalID)
	if err != nil {
		return genericEvidenceResponse{}, 0, err
	}
	unresolved := canonicalAgentID == nil
	correlationConfidence := 0.0
	if canonicalAgentID != nil {
		correlationConfidence = 1
	} else if canonical.AgentExternalID != nil {
		correlationConfidence = 0.5
	}
	var canonicalEventID string
	err = tx.QueryRow(ctx, `
		INSERT INTO canonical_evidence_event (
			tenant_id, workspace_id, source_record_id, mapping_revision_id, provider_type,
			source_event_id, occurred_at, received_at, principal_id, agent_external_id, canonical_agent_id,
			action, target_resource, policy_reference, environment, enforcement_decision,
			correlation_confidence, unresolved, source_attributes
		) VALUES (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::timestamptz, now(), $8, $9, $10,
			$11, $12, $13, $14, $15, $16, $17, $18::jsonb
		) RETURNING id::text
	`, command.TenantID, command.WorkspaceID, sourceRecordID, command.MappingRevisionID, command.ProviderType,
		canonical.SourceEventID, canonical.OccurredAt, canonical.PrincipalID, canonical.AgentExternalID,
		canonicalAgentID, canonical.Action, canonical.TargetResource, canonical.PolicyReference, canonical.Environment,
		canonical.EnforcementDecision, correlationConfidence, unresolved, string(canonical.SourceAttributes)).Scan(&canonicalEventID)
	if err != nil {
		return genericEvidenceResponse{}, 0, err
	}

	payload := map[string]any{
		"integrationId": command.IntegrationID, "mappingRevisionId": command.MappingRevisionID,
		"sourceRecordId": sourceRecordID, "sourceEventId": canonical.SourceEventID,
		"action": canonical.Action, "enforcementDecision": canonical.EnforcementDecision,
	}
	if err := appendGenericOperationsLogTx(ctx, tx, command.TenantID, command.WorkspaceID, "EVIDENCE_INGEST", canonicalEventID, "canonical_evidence_event", command.ActorID, payload); err != nil {
		return genericEvidenceResponse{}, 0, fmt.Errorf("append operations log: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return genericEvidenceResponse{}, 0, err
	}
	return genericEvidenceResponse{Outcome: "accepted", SourceRecordID: sourceRecordID, CanonicalEventID: canonicalEventID}, http.StatusCreated, nil
}

func resolveGenericEvidenceAgent(ctx context.Context, tx pgx.Tx, command genericEvidenceCommand, externalAgentID *string) (*string, error) {
	if externalAgentID == nil || strings.TrimSpace(*externalAgentID) == "" {
		return nil, nil
	}
	var canonicalAgentID string
	err := tx.QueryRow(ctx, `
		SELECT canonical_agent_id
		FROM agt_agent_surface_binding
		WHERE tenant_id = $1::uuid
		  AND workspace_id = $2::uuid
		  AND surface_type = $3
		  AND surface_agent_id = $4
		LIMIT 1
	`, command.TenantID, command.WorkspaceID, "evidence:"+command.ProviderType, *externalAgentID).Scan(&canonicalAgentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &canonicalAgentID, nil
}
