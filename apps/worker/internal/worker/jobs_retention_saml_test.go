package worker

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

// pruneExpiredSamlAuthnRequests must delete AuthnRequest cache rows past their
// expiry and leave still-valid ones intact. See migration 076.
func TestPruneExpiredSamlAuthnRequests(t *testing.T) {
	pool := testGatewayDB(t)
	ctx := context.Background()
	fx := newGatewayFixture(t, pool)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	insert := func(requestID string, expiresAt time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO saml_authn_request (request_id, tenant_id, value, expires_at)
			 VALUES ($1, $2, $3, $4)`,
			requestID, fx.tenantID, "2026-07-15T00:00:00Z", expiresAt,
		); err != nil {
			t.Fatalf("insert saml_authn_request %s: %v", requestID, err)
		}
	}
	exists := func(requestID string) bool {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM saml_authn_request WHERE request_id = $1`, requestID,
		).Scan(&n); err != nil {
			t.Fatalf("count saml_authn_request %s: %v", requestID, err)
		}
		return n > 0
	}

	expiredID := "itest-saml-expired-" + fx.suffix
	validID := "itest-saml-valid-" + fx.suffix
	insert(expiredID, time.Now().Add(-1*time.Hour).UTC())
	insert(validID, time.Now().Add(1*time.Hour).UTC())
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM saml_authn_request WHERE request_id = ANY($1)`,
			[]string{expiredID, validID})
	})

	if err := pruneExpiredSamlAuthnRequests(ctx, pool, logger); err != nil {
		t.Fatalf("pruneExpiredSamlAuthnRequests: %v", err)
	}

	if exists(expiredID) {
		t.Errorf("expected expired AuthnRequest %s to be pruned", expiredID)
	}
	if !exists(validID) {
		t.Errorf("expected valid AuthnRequest %s to survive the prune", validID)
	}
}
