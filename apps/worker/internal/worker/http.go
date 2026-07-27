package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// spawnTimeout bounds each fire-and-forget background task. Without it a hung
// task (e.g. a DB call that never returns) would keep a goroutine — and its
// pooled connection — alive forever, and block Server.Wait() at shutdown.
const spawnTimeout = 15 * time.Second

type Server struct {
	db           *pgxpool.Pool
	logger       *slog.Logger
	notification NotificationConfig
	ready        atomic.Bool
	wg           sync.WaitGroup
	// spawnSem bounds how many background tasks execute concurrently so an
	// ingest burst can't spawn unbounded goroutines all contending for the
	// small (MaxConns=2 on serverless) connection pool.
	spawnSem chan struct{}
}

func NewServer(db *pgxpool.Pool, logger *slog.Logger, notification NotificationConfig) *Server {
	// Size the background-work semaphore relative to the pool, with a floor so
	// tiny serverless pools still allow a little parallelism.
	sem := max(int(db.Config().MaxConns)*2, 4)
	return &Server{db: db, logger: logger, notification: notification, spawnSem: make(chan struct{}, sem)}
}

// spawn runs fn in a tracked goroutine with a bounded timeout context and a
// concurrency cap. Call Wait() during shutdown to drain all in-flight
// fire-and-forget work before the process exits. fn must respect ctx so it
// unblocks at the deadline rather than hanging.
func (s *Server) spawn(fn func(ctx context.Context)) {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// Acquire a slot (blocks under burst — cheap backpressure on a parked
		// goroutine, not on the request handler).
		s.spawnSem <- struct{}{}
		defer func() { <-s.spawnSem }()

		ctx, cancel := context.WithTimeout(context.Background(), spawnTimeout)
		defer cancel()
		fn(ctx)
	}()
}

// Wait blocks until all goroutines started with spawn have finished.
func (s *Server) Wait() { s.wg.Wait() }

func (s *Server) MarkReady() {
	s.ready.Store(true)
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/ready", s.handleReady)
	mux.HandleFunc("/readyz", s.handleReady)
	mux.HandleFunc("/metrics", s.handleMetrics)
	mux.HandleFunc("/api/evidence", s.handleEvidence)
	mux.HandleFunc("/api/gateway/claim", s.handleGatewayClaim)
	mux.HandleFunc("/api/gateway/decide", s.handleGatewayDecide)
	mux.HandleFunc("/api/gateway-ingest/helicone", s.handleGatewayIngestHelicone)
	mux.HandleFunc("/api/gateway-ingest/litellm", s.handleGatewayIngestLiteLLM)
	mux.HandleFunc("/api/gateway-ingest/portkey", s.handleGatewayIngestPortkey)
	mux.HandleFunc("/api/gateway/resolve", s.handleGatewayResolve)
	mux.HandleFunc("/api/token/refresh", s.handleTokenRefresh)
	mux.HandleFunc("/api/token/revoke", s.handleTokenRevoke)
	mux.HandleFunc("/api/trust/context-budget", s.handleTrustContextBudget)
	mux.HandleFunc("/api/trust/evaluate", s.handleTrustEvaluate)
	mux.HandleFunc("/api/trust/ingest", s.handleTrustIngest)
	mux.HandleFunc("/internal/jobs/retention-sweep", s.handleJobRetentionSweep)
	mux.HandleFunc("/internal/jobs/verification-sweep", s.handleJobVerificationSweep)
	mux.HandleFunc("/internal/jobs/metrics-sweep", s.handleJobMetricsSweep)
	mux.HandleFunc("/internal/jobs/escalation-sla", s.handleJobEscalationSLA)
	mux.HandleFunc("/internal/jobs/notification-sender", s.handleJobNotificationSender)
	mux.HandleFunc("/internal/jobs/siem-forwarder", s.handleJobSiemForwarder)
	return requestID(mux)
}

func authenticateJobTriggerRequest(w http.ResponseWriter, r *http.Request, traceID string) bool {
	secret := strings.TrimSpace(os.Getenv("SPCTRE_WORKER_INTERNAL_SECRET"))
	if secret == "" {
		writeError(w, http.StatusServiceUnavailable, "Worker internal API secret is not configured.", traceID, nil)
		return false
	}
	if !constantTimeSecretMatch(r.Header.Get("x-spctre-internal-secret"), secret) {
		writeError(w, http.StatusUnauthorized, "Internal worker authentication failed.", traceID, nil)
		return false
	}
	return true
}

// tryAdvisoryLock attempts to acquire a PostgreSQL session-level advisory lock.
// Returns (true, releaseFn, nil) when acquired. The caller must call releaseFn when done.
// Returns (false, nil, nil) when the lock is already held by another session.
func (s *Server) tryAdvisoryLock(ctx context.Context, lockID int64) (bool, func(), error) {
	lockCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := s.db.Acquire(lockCtx)
	if err != nil {
		return false, nil, err
	}
	var acquired bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", lockID).Scan(&acquired); err != nil {
		conn.Release()
		return false, nil, err
	}
	if !acquired {
		conn.Release()
		return false, nil, nil
	}
	release := func() {
		_, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", lockID)
		conn.Release()
	}
	return true, release, nil
}

// beginTenantTx starts a transaction scoped to a specific tenant for RLS
// enforcement. It sets the PostgreSQL role to spctre_app and configures
// app.current_tenant_id so that row-level security policies restrict all
// queries to the specified tenant's rows. Background jobs that need
// cross-tenant access should use s.db.Begin() directly (owner role bypasses
// RLS).
func (s *Server) beginTenantTx(ctx context.Context, tenantID string) (pgx.Tx, error) {
	if !uuidRE.MatchString(tenantID) {
		return nil, fmt.Errorf("invalid tenant ID")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE spctre_app"); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	// SET does not support $1 parameters in pgx extended protocol; use set_config instead.
	if _, err := tx.Exec(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}

// runJobEndpoint handles the advisory lock, context detachment, timing, and response
// for a triggered job. Callers must perform method and auth checks before calling.
func (s *Server) runJobEndpoint(w http.ResponseWriter, r *http.Request, name string, lockID int64, fn func(context.Context) error) {
	tid := traceID(r)
	// Detach from the HTTP request context so the job continues even if the
	// external scheduler closes the connection before the job finishes.
	jobCtx := context.WithoutCancel(r.Context())
	acquired, release, err := s.tryAdvisoryLock(jobCtx, lockID)
	if err != nil {
		s.logger.Error("advisory lock error", "job", name, "error", err)
		writeError(w, http.StatusInternalServerError, "Job execution failed.", tid, nil)
		return
	}
	if !acquired {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "job": name, "skipped": true, "reason": "already running"})
		return
	}
	defer release()
	started := time.Now()
	if err := fn(jobCtx); err != nil {
		s.logger.Error("job http trigger failed", "job", name, "error", err)
		writeError(w, http.StatusInternalServerError, "Job execution failed.", tid, nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "job": name, "durationMs": time.Since(started).Milliseconds()})
}

func (s *Server) handleJobRetentionSweep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID(r), nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, traceID(r)) {
		return
	}
	s.runJobEndpoint(w, r, "retention-sweep", LockIDRetentionSweep, func(ctx context.Context) error {
		return runRetention(ctx, s.db, s.logger)
	})
}

func (s *Server) handleJobVerificationSweep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID(r), nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, traceID(r)) {
		return
	}
	s.runJobEndpoint(w, r, "verification-sweep", LockIDVerificationSweep, func(ctx context.Context) error {
		return runVerificationSweep(ctx, s.db, s.logger)
	})
}

func (s *Server) handleJobMetricsSweep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID(r), nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, traceID(r)) {
		return
	}
	s.runJobEndpoint(w, r, "metrics-sweep", LockIDMetricsSweep, func(ctx context.Context) error {
		return runMetricsSweep(ctx, s.db, s.logger)
	})
}

func (s *Server) handleJobEscalationSLA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID(r), nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, traceID(r)) {
		return
	}
	s.runJobEndpoint(w, r, "escalation-sla", LockIDEscalationSLA, func(ctx context.Context) error {
		return runEscalationSLAMonitor(ctx, s.db, s.logger)
	})
}

func (s *Server) handleJobNotificationSender(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID(r), nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, traceID(r)) {
		return
	}
	s.runJobEndpoint(w, r, "notification-sender", LockIDNotificationSender, func(ctx context.Context) error {
		return runNotificationSender(ctx, s.db, s.logger, s.notification, safeHTTPClient)
	})
}

func (s *Server) handleJobSiemForwarder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed.", traceID(r), nil)
		return
	}
	if !authenticateJobTriggerRequest(w, r, traceID(r)) {
		return
	}
	s.runJobEndpoint(w, r, "siem-forwarder", LockIDSiemForwarder, func(ctx context.Context) error {
		return runSiemForwarder(ctx, s.db, s.logger, safeHTTPClient)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "unit": "worker-go"})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	checks := map[string]map[string]any{
		"initialized": {"ok": s.ready.Load()},
	}
	if err := s.db.Ping(r.Context()); err != nil {
		checks["db"] = map[string]any{"ok": false, "reason": err.Error()}
	} else {
		checks["db"] = map[string]any{"ok": true}
	}

	ok := true
	for _, check := range checks {
		if check["ok"] != true {
			ok = false
			break
		}
	}
	status := http.StatusOK
	if !ok {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": ok, "unit": "worker-go", "checks": checks})
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	stats := s.db.Stat()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	_, _ = w.Write([]byte(
		"# HELP spctre_worker_db_pool_acquired Active acquired database connections.\n" +
			"# TYPE spctre_worker_db_pool_acquired gauge\n" +
			formatMetric("spctre_worker_db_pool_acquired", float64(stats.AcquiredConns())) +
			"# HELP spctre_worker_db_pool_idle Idle database connections.\n" +
			"# TYPE spctre_worker_db_pool_idle gauge\n" +
			formatMetric("spctre_worker_db_pool_idle", float64(stats.IdleConns())) +
			"# HELP spctre_worker_db_pool_total Total database connections.\n" +
			"# TYPE spctre_worker_db_pool_total gauge\n" +
			formatMetric("spctre_worker_db_pool_total", float64(stats.TotalConns())),
	))
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Default().Error("failed to write json response", "error", err)
	}
}

func formatMetric(name string, value float64) string {
	return name + " " + strconv.FormatFloat(value, 'f', -1, 64) + "\n"
}

func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("x-request-id")
		if traceID == "" {
			traceID = r.Header.Get("traceparent")
		}
		if traceID != "" {
			w.Header().Set("x-request-id", traceID)
		}
		next.ServeHTTP(w, r)
	})
}
