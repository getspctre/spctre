package worker

// Integration coverage for the gateway credential-broker and replay paths
// (findAndBrokerCredential, hasCredentialGrantBeenIssued, blockReplayedDecision).
// These are DB-transactional and security-critical (JIT credential issuance and
// replay-attack prevention), so they are exercised against a real Postgres.
//
// The suite SKIPS when no database is configured, keeping `go test ./...` green
// in environments without a DB. To run it, point it at a migrated database:
//
//	SPCTRE_WORKER_TEST_DATABASE_URL=postgres://spctre:spctre@localhost:5433/spctre \
//	  go test ./internal/worker/ -run Credential
//
// (DATABASE_URL is used as a fallback.) Each test creates an isolated tenant and
// tears it down via ON DELETE CASCADE, so runs never collide with each other or
// with demo/seed data.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// testGatewayDB returns a pool for the configured test database, or skips.
func testGatewayDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("SPCTRE_WORKER_TEST_DATABASE_URL")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		t.Skip("no database configured; set SPCTRE_WORKER_TEST_DATABASE_URL (or DATABASE_URL) to run gateway credential integration tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skipf("cannot create pool for the test database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("cannot reach the test database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func testServer(pool *pgxpool.Pool) *Server {
	return &Server{db: pool, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

// gatewayFixture is an isolated tenant+workspace whose rows (and everything that
// references them) are removed on cleanup via ON DELETE CASCADE.
type gatewayFixture struct {
	pool        *pgxpool.Pool
	tenantID    string
	workspaceID string
	suffix      string
}

func newGatewayFixture(t *testing.T, pool *pgxpool.Pool) gatewayFixture {
	t.Helper()
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())

	var tenantID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id`,
		"itest-"+suffix, "Integration Test Tenant",
	).Scan(&tenantID); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tenantID)
	})

	var workspaceID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO workspace (tenant_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
		tenantID, "itest-ws-"+suffix, "Integration Test Workspace",
	).Scan(&workspaceID); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}

	return gatewayFixture{pool: pool, tenantID: tenantID, workspaceID: workspaceID, suffix: suffix}
}

func (f gatewayFixture) insertBroker(t *testing.T, connector, action, credentialType, injectedParameter string) {
	t.Helper()
	_, err := f.pool.Exec(context.Background(),
		`INSERT INTO gateway_credential_broker
		   (tenant_id, workspace_id, connector, action, credential_type, injected_parameter, broker_config)
		 VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)`,
		f.tenantID, f.workspaceID, connector, action, credentialType, injectedParameter,
	)
	if err != nil {
		t.Fatalf("insert broker (%s/%s): %v", connector, action, err)
	}
}

// insertDecision creates a gateway_decision and returns its uuid (the
// gateway_decision_id a grant references) and the caller-supplied decision_id.
func (f gatewayFixture) insertDecision(t *testing.T, decisionID string) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(context.Background(),
		`INSERT INTO gateway_decision
		   (tenant_id, workspace_id, decision_id, artifact_hash, outcome, reason, evaluated_by)
		 VALUES ($1, $2, $3, 'sha256:itest', 'PROCEED', 'integration test', 'itest')
		 RETURNING id`,
		f.tenantID, f.workspaceID, decisionID,
	).Scan(&id); err != nil {
		t.Fatalf("insert gateway_decision: %v", err)
	}
	return id
}

func (f gatewayFixture) grantCount(t *testing.T, gatewayDecisionID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM gateway_credential_grant WHERE gateway_decision_id = $1`, gatewayDecisionID,
	).Scan(&n); err != nil {
		t.Fatalf("count grants: %v", err)
	}
	return n
}

func TestFindAndBrokerCredentialNoBrokerReturnsNil(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	decUUID := f.insertDecision(t, "dec-nobroker-"+f.suffix)

	grant, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if grant != nil {
		t.Fatalf("expected nil grant when no broker is configured, got %+v", grant)
	}
	if got := f.grantCount(t, decUUID); got != 0 {
		t.Fatalf("expected no grant rows, got %d", got)
	}
}

func TestFindAndBrokerCredentialIssuesMockGrant(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	f.insertBroker(t, "stripe", "*", "MOCK", "apiKey")
	decUUID := f.insertDecision(t, "dec-mock-"+f.suffix)

	grant, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if grant == nil {
		t.Fatal("expected a grant, got nil")
	}
	if grant.CredentialType != "MOCK" {
		t.Errorf("CredentialType = %q, want MOCK", grant.CredentialType)
	}
	if grant.InjectedParameter != "apiKey" {
		t.Errorf("InjectedParameter = %q, want apiKey", grant.InjectedParameter)
	}
	if !strings.HasPrefix(grant.CredentialValue, "ephemeral-mock-token-") {
		t.Errorf("CredentialValue = %q, want ephemeral-mock-token- prefix", grant.CredentialValue)
	}
	if !grant.ExpiresAt.After(time.Now()) {
		t.Errorf("ExpiresAt = %v, want a future time", grant.ExpiresAt)
	}
	if got := f.grantCount(t, decUUID); got != 1 {
		t.Errorf("grant rows = %d, want 1", got)
	}
}

func TestFindAndBrokerCredentialStripeRestrictedPrefix(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	f.insertBroker(t, "stripe", "*", "STRIPE_RESTRICTED", "token")
	decUUID := f.insertDecision(t, "dec-stripe-"+f.suffix)

	grant, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if grant == nil || !strings.HasPrefix(grant.CredentialValue, "rk_test_jit_") {
		t.Fatalf("expected rk_test_jit_ prefixed value, got %+v", grant)
	}
}

// Replay/contention: a second broker attempt for the same decision must not
// issue a second credential — it returns errCredentialAlreadyIssued.
func TestFindAndBrokerCredentialSecondCallReturnsAlreadyIssued(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	f.insertBroker(t, "stripe", "*", "MOCK", "apiKey")
	decUUID := f.insertDecision(t, "dec-replay-"+f.suffix)

	if _, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge"); err != nil {
		t.Fatalf("first broker call failed: %v", err)
	}
	_, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge")
	if err != errCredentialAlreadyIssued {
		t.Fatalf("second call error = %v, want errCredentialAlreadyIssued", err)
	}
	if got := f.grantCount(t, decUUID); got != 1 {
		t.Errorf("grant rows = %d, want exactly 1 after a replayed attempt", got)
	}
}

// An exact action match wins over the '*' wildcard broker (ORDER BY action DESC).
func TestFindAndBrokerCredentialExactActionPreferredOverWildcard(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	f.insertBroker(t, "stripe", "charge", "MOCK", "chargeKey")
	f.insertBroker(t, "stripe", "*", "MOCK", "wildcardKey")
	decUUID := f.insertDecision(t, "dec-exact-"+f.suffix)

	grant, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if grant == nil || grant.InjectedParameter != "chargeKey" {
		t.Fatalf("expected the exact-action broker (chargeKey), got %+v", grant)
	}
}

func TestHasCredentialGrantBeenIssued(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	f.insertBroker(t, "stripe", "*", "MOCK", "apiKey")
	decisionID := "dec-has-" + f.suffix
	decUUID := f.insertDecision(t, decisionID)

	if issued, err := s.hasCredentialGrantBeenIssued(context.Background(), f.tenantID, decisionID); err != nil || issued {
		t.Fatalf("before broker: issued=%v err=%v, want false/nil", issued, err)
	}

	if _, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge"); err != nil {
		t.Fatalf("broker call failed: %v", err)
	}

	if issued, err := s.hasCredentialGrantBeenIssued(context.Background(), f.tenantID, decisionID); err != nil || !issued {
		t.Fatalf("after broker: issued=%v err=%v, want true/nil", issued, err)
	}

	if issued, err := s.hasCredentialGrantBeenIssued(context.Background(), f.tenantID, "dec-does-not-exist-"+f.suffix); err != nil || issued {
		t.Fatalf("unknown decision: issued=%v err=%v, want false/nil", issued, err)
	}
}

func TestBlockReplayedDecisionBlocksWhenGrantExists(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)
	f.insertBroker(t, "stripe", "*", "MOCK", "apiKey")
	decisionID := "dec-block-" + f.suffix
	decUUID := f.insertDecision(t, decisionID)
	if _, err := s.findAndBrokerCredential(context.Background(), f.tenantID, f.workspaceID, decUUID, "stripe", "charge"); err != nil {
		t.Fatalf("broker call failed: %v", err)
	}

	w := httptest.NewRecorder()
	blocked := s.blockReplayedDecision(context.Background(), w, "trace-block", f.tenantID, decisionID, true, GatewayDecision{Outcome: "PROCEED"})
	if !blocked {
		t.Fatal("expected the replayed decision to be blocked")
	}

	var resp gatewayDecisionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, w.Body.String())
	}
	if resp.Decision.Outcome != "ABORT" {
		t.Errorf("Decision.Outcome = %q, want ABORT", resp.Decision.Outcome)
	}
	if resp.Persisted {
		t.Error("Persisted = true, want false for a blocked replay")
	}
}

func TestBlockReplayedDecisionAllowsWhenNoGrant(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	s := testServer(pool)

	w := httptest.NewRecorder()
	blocked := s.blockReplayedDecision(context.Background(), w, "trace-allow", f.tenantID, "dec-none-"+f.suffix, true, GatewayDecision{Outcome: "PROCEED"})
	if blocked {
		t.Fatal("expected no block when no grant exists")
	}
	if w.Body.Len() != 0 {
		t.Errorf("expected no response written, got %q", w.Body.String())
	}
}
