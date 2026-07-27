package worker

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// resolveGatewayCanonicalAgent keeps worker-side enforcement aligned with the
// web fallback: a registered surface ID governs as its canonical agent.
func (s *Server) resolveGatewayCanonicalAgent(ctx context.Context, auth authResult, agentID *string) error {
	if agentID == nil || *agentID == "" {
		return nil
	}
	var canonical string
	err := s.db.QueryRow(ctx, `
		SELECT canonical_agent_id FROM agt_agent_surface_binding
		WHERE tenant_id = $1 AND workspace_id = $2 AND surface_agent_id = $3
		LIMIT 1
	`, auth.TenantID, auth.WorkspaceID, *agentID).Scan(&canonical)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	*agentID = canonical
	return nil
}
