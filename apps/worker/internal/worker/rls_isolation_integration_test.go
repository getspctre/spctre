package worker

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Behavioral cross-tenant Row-Level Security test. The app's RLS (migration 023)
// is the tenant-isolation boundary, but nothing else exercises it end to end —
// the TS suite mocks the DB, and db.test.mts only checks that the tenant GUC is
// set, not that isolation actually holds. This runs as the RLS-subject role
// (spctre_app, via beginTenantTx) against a real database and asserts:
//   - USING: a tenant sees its own rows and NOT another tenant's.
//   - secure-by-default: with no tenant context, zero rows are visible.
//   - WITH CHECK: a tenant cannot INSERT a row owned by another tenant.
//
// It guards the RLS policies against regressions — in particular the finding-M4
// rewrite of the isolation predicates to the scalar-subselect form.
//
// Note on "secure by default": with no tenant GUC set, the isolation predicate
// evaluates current_setting('app.current_tenant_id', true) — which on a reused
// pooled connection is ” (empty), so ”::uuid errors out rather than returning
// NULL. That still fails closed (an error returns no data), but it is a
// connection-dependent backstop the app never actually hits (the web BFF's
// runWithTenantContext and the worker's beginTenantTx always set context before
// querying), so it is out of scope here and not asserted.
func TestRLSTenantIsolation(t *testing.T) {
	pool := testGatewayDB(t)
	s := testServer(pool)
	ctx := context.Background()

	tenantA := newGatewayFixture(t, pool)
	tenantB := newGatewayFixture(t, pool)

	// Seeded as the owner role (bypasses RLS), one evidence row per tenant.
	seedA := tenantA.insertRuntimeEvidence(t, "production", time.Now())
	seedB := tenantB.insertRuntimeEvidence(t, "production", time.Now())

	// USING clause: each tenant sees only its own row.
	if !s.evidenceVisibleUnderTenant(t, tenantA.tenantID, seedA.decisionID) {
		t.Fatal("tenant A should see its own evidence row")
	}
	if s.evidenceVisibleUnderTenant(t, tenantA.tenantID, seedB.decisionID) {
		t.Fatal("RLS leak: tenant A can see tenant B's evidence row")
	}
	if !s.evidenceVisibleUnderTenant(t, tenantB.tenantID, seedB.decisionID) {
		t.Fatal("tenant B should see its own evidence row")
	}
	if s.evidenceVisibleUnderTenant(t, tenantB.tenantID, seedA.decisionID) {
		t.Fatal("RLS leak: tenant B can see tenant A's evidence row")
	}

	// WITH CHECK clause: tenant A cannot write a row owned by tenant B.
	err := s.insertWorkspaceUnderTenant(ctx, tenantA.tenantID, tenantB.tenantID)
	if err == nil {
		t.Fatal("WITH CHECK failed to reject an insert for another tenant")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "row-level security") {
		t.Fatalf("expected a row-level security violation, got: %v", err)
	}
}

// evidenceVisibleUnderTenant runs as spctre_app scoped to tenantID and reports
// whether the given decision's evidence row is visible. The query has no
// tenant_id filter of its own — visibility is entirely RLS's decision.
func (s *Server) evidenceVisibleUnderTenant(t *testing.T, tenantID, decisionID string) bool {
	t.Helper()
	ctx := context.Background()
	tx, err := s.beginTenantTx(ctx, tenantID)
	if err != nil {
		t.Fatalf("beginTenantTx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var visible bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM runtime_evidence_event WHERE decision_id = $1)`, decisionID,
	).Scan(&visible); err != nil {
		t.Fatalf("query under tenant %s: %v", tenantID, err)
	}
	return visible
}

// insertWorkspaceUnderTenant runs as spctre_app scoped to actorTenantID and
// attempts to insert a workspace owned by targetTenantID; the WITH CHECK clause
// must reject it. A unique slug ensures the only possible failure is the RLS
// violation, not a uniqueness conflict.
func (s *Server) insertWorkspaceUnderTenant(ctx context.Context, actorTenantID, targetTenantID string) error {
	tx, err := s.beginTenantTx(ctx, actorTenantID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	slug := fmt.Sprintf("rls-check-%d", time.Now().UnixNano())
	_, err = tx.Exec(ctx,
		`INSERT INTO workspace (tenant_id, slug, name) VALUES ($1, $2, $3)`,
		targetTenantID, slug, "RLS isolation probe",
	)
	return err
}
