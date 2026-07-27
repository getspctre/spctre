package worker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func credentialSuffix() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// blockReplayedDecision short-circuits a decision whose credential grant was
// already issued (a replay): it writes an ABORT response and returns true. A
// nil/false return means the caller should proceed normally; an error checking
// the grant also writes a terminal response and returns true. Extracted from
// handleGatewayDecide (maintainability audit Hotspot 5).
func (s *Server) blockReplayedDecision(ctx context.Context, w http.ResponseWriter, traceID string, tenantID, decisionID string, gatewayEnabled bool, decision GatewayDecision) bool {
	alreadyIssued, err := s.hasCredentialGrantBeenIssued(ctx, tenantID, decisionID)
	if err != nil {
		s.logger.Error("failed to check if grant was issued", "error", err, "decision_id", decisionID)
		writeError(w, http.StatusInternalServerError, "Internal server error.", traceID, nil)
		return true
	}
	if !alreadyIssued {
		return false
	}

	decision.Outcome = "ABORT"
	decision.Reason = "Credential grant already issued for this decision."
	decision.RiskLevel = "CRITICAL"
	decision.ShouldQueue = false

	s.logger.Warn("replay attack blocked: credential grant already issued", "decision_id", decisionID)
	writeJSON(w, http.StatusOK, gatewayDecisionResponse{
		GatewayEnabled: gatewayEnabled,
		Mode:           gatewayMode(),
		Persisted:      false,
		Queued:         false,
		Decision:       decision,
		Meta:           makeMeta(traceID),
	})
	return true
}

// brokerCredentialForDecision attaches a brokered credential to a PROCEED
// decision, or downgrades it to ABORT on contention or brokering failure. It
// returns the (possibly mutated) decision and, when the second return is true,
// signals that a terminal error response has already been written to w and the
// caller must stop. Extracted from handleGatewayDecide to keep that handler a
// short orchestration (maintainability audit Hotspot 5).
func (s *Server) brokerCredentialForDecision(ctx context.Context, w http.ResponseWriter, traceID string, payload GatewayDecisionRequest, auth authResult, gatewayDecisionID string, gatewayEnabled bool, decision GatewayDecision) (GatewayDecision, bool) {
	grant, err := s.findAndBrokerCredential(ctx, auth.TenantID, auth.WorkspaceID, gatewayDecisionID, *payload.Connector, *payload.Action)
	if errors.Is(err, errCredentialAlreadyIssued) {
		// Another concurrent request already won the insert. Don't corrupt the
		// persisted decision (it stays PROCEED with the winner's credential),
		// but fail closed for THIS request so the tool isn't allowed without a credential.
		s.logger.Warn("credential already issued by concurrent request", "decision_id", payload.DecisionID, "gateway_decision_id", gatewayDecisionID)
		decision.Outcome = "ABORT"
		decision.Reason = "Credential already issued by a concurrent request."
		decision.CredentialGrant = nil
		return decision, false
	} else if err != nil {
		s.logger.Error("credential brokering error", "error", err, "decision_id", payload.DecisionID)

		_, updateErr := s.db.Exec(ctx, `
			UPDATE gateway_decision
			SET outcome = 'ABORT', reason = 'Credential brokering failed.'
			WHERE id = $1 AND tenant_id = $2
		`, gatewayDecisionID, auth.TenantID)
		if updateErr != nil {
			s.logger.Error("CRITICAL: brokering failed AND could not persist ABORT to gateway_decision row", "error", updateErr, "decision_id", payload.DecisionID)
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error":          "Credential brokering failed and the decision record could not be updated. Retry later.",
				"gatewayEnabled": gatewayEnabled,
				"persisted":      true,
				"queued":         false,
				"decision": map[string]any{
					"outcome": "ABORT",
					"reason":  "Credential brokering failed — persistence unavailable.",
				},
				"meta": makeMeta(traceID),
			})
			return decision, true
		}

		decision.Outcome = "ABORT"
		decision.Reason = "Credential brokering failed."
		return decision, false
	} else if grant != nil {
		g := CredentialGrant{
			CredentialType:    grant.CredentialType,
			InjectedParameter: grant.InjectedParameter,
			CredentialValue:   grant.CredentialValue,
			ExpiresAt:         grant.ExpiresAt,
		}
		decision.CredentialGrant = &g
	}
	return decision, false
}

type goCredentialGrant struct {
	CredentialType    string    `json:"credentialType"`
	InjectedParameter string    `json:"injectedParameter"`
	CredentialValue   string    `json:"credentialValue"`
	ExpiresAt         time.Time `json:"expiresAt"`
}

// errCredentialAlreadyIssued is returned by findAndBrokerCredential when
// ON CONFLICT fires, meaning another concurrent request already won the insert.
var errCredentialAlreadyIssued = errors.New("credential grant already issued by concurrent request")

type goCredentialBroker struct {
	ID                string
	CredentialType    string
	InjectedParameter string
	BrokerConfig      string
}

func (s *Server) findAndBrokerCredential(ctx context.Context, tenantID, workspaceID, gatewayDecisionID, connector, action string) (*goCredentialGrant, error) {
	var broker goCredentialBroker
	err := s.db.QueryRow(ctx, `
		SELECT id, credential_type, injected_parameter, broker_config::text
		FROM gateway_credential_broker
		WHERE tenant_id = $1
		  AND workspace_id = $2
		  AND connector = $3
		  AND (action = $4 OR action = '*')
		ORDER BY action DESC
		LIMIT 1
	`, tenantID, workspaceID, connector, action).Scan(&broker.ID, &broker.CredentialType, &broker.InjectedParameter, &broker.BrokerConfig)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().Add(5 * time.Minute)
	var credentialValue string

	switch broker.CredentialType {
	case "STRIPE_RESTRICTED":
		suffix, err := credentialSuffix()
		if err != nil {
			return nil, err
		}
		credentialValue = fmt.Sprintf("rk_test_jit_%s", suffix)
	case "MOCK":
		suffix, err := credentialSuffix()
		if err != nil {
			return nil, err
		}
		credentialValue = fmt.Sprintf("ephemeral-mock-token-%s", suffix)
	default:
		return nil, fmt.Errorf("unsupported credential type: %s", broker.CredentialType)
	}

	if credentialValue == "" {
		return nil, fmt.Errorf("empty credential value generated for type %s", broker.CredentialType)
	}

	var grantID string
	err = s.db.QueryRow(ctx, `
		INSERT INTO gateway_credential_grant (
			tenant_id, workspace_id, gateway_decision_id, broker_id, injected_parameter, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (gateway_decision_id) DO NOTHING
		RETURNING id
	`, tenantID, workspaceID, gatewayDecisionID, broker.ID, broker.InjectedParameter, expiresAt).Scan(&grantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errCredentialAlreadyIssued
	}
	if err != nil {
		return nil, err
	}

	return &goCredentialGrant{
		CredentialType:    broker.CredentialType,
		InjectedParameter: broker.InjectedParameter,
		CredentialValue:   credentialValue,
		ExpiresAt:         expiresAt,
	}, nil
}

func (s *Server) hasCredentialGrantBeenIssued(ctx context.Context, tenantID, decisionID string) (bool, error) {
	// EXISTS stops at the first matching grant instead of counting them all.
	// See database-optimizations-audit (Minor).
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM gateway_credential_grant gcg
			JOIN gateway_decision gd ON gd.id = gcg.gateway_decision_id
			WHERE gd.tenant_id = $1
			  AND gd.decision_id = $2
		)
	`, tenantID, decisionID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
