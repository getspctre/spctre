package worker

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type gatewayInternalAuth struct {
	TenantID    string
	WorkspaceID string
	ActorID     string
}

type gatewayClaimRequest struct {
	QueueID string `json:"queueId"`
}

type gatewayDecisionResponse struct {
	GatewayEnabled bool            `json:"gatewayEnabled"`
	Mode           string          `json:"mode"`
	Persisted      bool            `json:"persisted"`
	Queued         bool            `json:"queued"`
	Decision       GatewayDecision `json:"decision"`
	Meta           APIMeta         `json:"meta"`
}

func (s *Server) handleGatewayClaim(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	auth, ok := authenticateInternalGatewayRequest(w, r, traceID)
	if !ok {
		return
	}

	var payload gatewayClaimRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Request body must be JSON.", traceID, nil)
		return
	}
	if strings.TrimSpace(payload.QueueID) == "" {
		writeError(w, http.StatusBadRequest, "queueId is required.", traceID, []validationIssue{{Path: "queueId", Message: "queueId is required."}})
		return
	}

	ok, err := s.claimGatewayEscalation(r.Context(), auth, payload.QueueID)
	if err != nil {
		s.logger.Error("gateway claim database error", "error", err, "queue_id", payload.QueueID)
		writeError(w, http.StatusInternalServerError, "Gateway escalation could not be claimed.", traceID, nil)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "Escalation item not found, already assigned, or already resolved.", traceID, nil)
		return
	}

	if err := s.appendGenericOperationsLog(r.Context(), auth.TenantID, auth.WorkspaceID, "ESCALATION_CLAIMED", payload.QueueID, "gateway_escalation_queue", auth.ActorID, map[string]any{
		"queueId":    payload.QueueID,
		"action":     "CLAIMED",
		"assignedTo": auth.ActorID,
	}); err != nil {
		s.logger.Warn("gateway claim operations log append failed", "error", err, "queue_id", payload.QueueID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": makeMeta(traceID)})
}

func (s *Server) handleGatewayDecide(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	var payload GatewayDecisionRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Request body must be JSON.", traceID, nil)
		return
	}

	if issues := payload.validate(); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, issues[0].Message, traceID, issues)
		return
	}

	sanitizeGatewayDecisionRequest(&payload)

	auth, err := s.authenticateRuntimeRequest(r.Context(), r, EvidenceRequest{
		TenantID:      derefString(payload.TenantID),
		WorkspaceID:   derefString(payload.WorkspaceID),
		PolicyContext: payload.PolicyContext,
	})
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error(), traceID, nil)
		return
	}

	if err := s.validateWorkspaceBoundary(r.Context(), auth.TenantID, auth.WorkspaceID); err != nil {
		writeError(w, http.StatusForbidden, err.Error(), traceID, nil)
		return
	}
	if err := s.validatePolicyContextBoundary(r.Context(), payload.PolicyContext, auth.TenantID, auth.WorkspaceID); err != nil {
		writeError(w, http.StatusForbidden, err.Error(), traceID, nil)
		return
	}
	if err := s.resolveGatewayCanonicalAgent(r.Context(), auth, payload.AgentID); err != nil {
		s.logger.Error("gateway agent identity resolution failed", "error", err, "decision_id", payload.DecisionID)
		writeError(w, http.StatusServiceUnavailable, "Gateway identity resolution unavailable.", traceID, nil)
		return
	}

	gatewayEnabled := gatewayEnabled()
	decision := GatewayDecision{
		Outcome:     "PROCEED",
		Reason:      "Gateway disabled; proceeding by configuration.",
		RiskLevel:   "LOW",
		ShouldQueue: false,
	}
	var payloadSafeguardTelemetry *gatewaySafeguardTelemetry
	if gatewayEnabled {
		decision = evaluateGatewayDecision(payload)
		var payloadTelemetry *gatewaySafeguardTelemetry
		decision, payloadTelemetry = applyGatewayPayloadGuardrail(payload, decision)
		var safeguardErr error
		var safeguardTelemetry *gatewaySafeguardTelemetry
		decision, safeguardTelemetry, safeguardErr = s.applyGatewayBlueprintSafeguards(r.Context(), payload, auth, decision)
		if safeguardErr != nil {
			s.logger.Error("gateway safeguard evaluation failed", "error", safeguardErr, "decision_id", payload.DecisionID)
			writeError(w, http.StatusServiceUnavailable, "Gateway safeguard evaluation unavailable.", traceID, nil)
			return
		}
		payloadSafeguardTelemetry = mergeGatewaySafeguardTelemetry(safeguardTelemetry, payloadTelemetry)
	}

	isDemo := isDemoTenant(auth.TenantID)

	if gatewayEnabled && !isDemo {
		if wroteReplayResponse := s.blockReplayedDecision(r.Context(), w, traceID, auth.TenantID, payload.DecisionID, gatewayEnabled, decision); wroteReplayResponse {
			return
		}
	}

	persisted := false
	var gatewayDecisionID string
	if gatewayEnabled && !isDemo {
		var err error
		gatewayDecisionID, err = s.persistGatewayDecision(r.Context(), payload, auth, decision, payloadSafeguardTelemetry)
		if err != nil {
			s.logger.Error("gateway decision database error", "error", err, "decision_id", payload.DecisionID)
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error":          "Gateway decision could not be persisted.",
				"gatewayEnabled": gatewayEnabled,
				"persisted":      false,
				"queued":         false,
				"decision":       decision,
				"meta":           makeMeta(traceID),
			})
			return
		}
		persisted = true
	}

	if decision.Outcome == "PROCEED" && payload.Connector != nil && payload.Action != nil && gatewayDecisionID != "" {
		var wroteFatal bool
		decision, wroteFatal = s.brokerCredentialForDecision(r.Context(), w, traceID, payload, auth, gatewayDecisionID, gatewayEnabled, decision)
		if wroteFatal {
			return
		}
	}

	s.logger.Info("gateway decision evaluated", "decision_id", payload.DecisionID, "outcome", decision.Outcome, "queued", gatewayEnabled && decision.ShouldQueue && !isDemo, "duration_ms", time.Since(started).Milliseconds())
	writeJSON(w, http.StatusOK, gatewayDecisionResponse{
		GatewayEnabled: gatewayEnabled,
		Mode:           gatewayMode(),
		Persisted:      persisted,
		Queued:         gatewayEnabled && decision.ShouldQueue && !isDemo,
		Decision:       decision,
		Meta:           makeMeta(traceID),
	})
}

func (s *Server) handleGatewayResolve(w http.ResponseWriter, r *http.Request) {
	traceID := traceID(r)
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID, nil)
		return
	}

	auth, ok := authenticateInternalGatewayRequest(w, r, traceID)
	if !ok {
		return
	}

	var payload GatewayResolveRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "Request body must be JSON.", traceID, nil)
		return
	}
	if issues := payload.validate(); len(issues) > 0 {
		writeError(w, http.StatusBadRequest, issues[0].Message, traceID, issues)
		return
	}

	ok, err := s.resolveGatewayEscalation(r.Context(), auth, payload)
	if err != nil {
		s.logger.Error("gateway resolve database error", "error", err, "queue_id", payload.QueueID)
		writeError(w, http.StatusInternalServerError, "Gateway escalation could not be resolved.", traceID, nil)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "Escalation queue item not found or already resolved.", traceID, nil)
		return
	}

	if err := s.appendGenericOperationsLog(r.Context(), auth.TenantID, auth.WorkspaceID, "ESCALATION_RESOLVED", payload.QueueID, "gateway_escalation_queue", auth.ActorID, map[string]any{
		"queueId":           payload.QueueID,
		"resolutionOutcome": payload.ResolutionOutcome,
		"resolutionNote":    payload.ResolutionNote,
		"agentGuidance":     payload.AgentGuidance,
	}); err != nil {
		s.logger.Warn("gateway resolve operations log append failed", "error", err, "queue_id", payload.QueueID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": makeMeta(traceID)})
}

func authenticateInternalGatewayRequest(w http.ResponseWriter, r *http.Request, traceID string) (gatewayInternalAuth, bool) {
	secret := strings.TrimSpace(os.Getenv("SPCTRE_WORKER_INTERNAL_SECRET"))
	if secret == "" {
		writeError(w, http.StatusServiceUnavailable, "Worker internal API secret is not configured.", traceID, nil)
		return gatewayInternalAuth{}, false
	}
	if !constantTimeSecretMatch(r.Header.Get("x-spctre-internal-secret"), secret) {
		writeError(w, http.StatusUnauthorized, "Internal worker authentication failed.", traceID, nil)
		return gatewayInternalAuth{}, false
	}

	auth := gatewayInternalAuth{
		TenantID:    strings.TrimSpace(r.Header.Get("x-spctre-tenant-id")),
		WorkspaceID: strings.TrimSpace(r.Header.Get("x-spctre-workspace-id")),
		ActorID:     strings.TrimSpace(r.Header.Get("x-spctre-actor-id")),
	}
	if auth.TenantID == "" || auth.WorkspaceID == "" || auth.ActorID == "" {
		writeError(w, http.StatusBadRequest, "Internal worker request is missing tenant, workspace, or actor context.", traceID, nil)
		return gatewayInternalAuth{}, false
	}
	return auth, true
}

func gatewayEnabled() bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv("GATEWAY_ENABLED")))
	return raw == "1" || raw == "true" || raw == "yes" || raw == "on"
}

func gatewayMode() string {
	if value := strings.TrimSpace(os.Getenv("GATEWAY_MODE")); value != "" {
		return value
	}
	return "HYBRID"
}

func nullableString(ok bool, value string) any {
	if !ok || strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func stringPtrEqual(left *string, right *string) bool {
	if right == nil {
		return left == nil
	}
	if left == nil {
		return false
	}
	return *left == *right
}

func strconvI(value int) string {
	return strconv.Itoa(value)
}

func isDemoTenant(tenantID string) bool {
	demoID := strings.TrimSpace(os.Getenv("SPCTRE_DEMO_TENANT_ID"))
	if demoID == "" {
		demoID = "00000000-0000-0000-0000-000000000001"
	}
	return tenantID == demoID
}
