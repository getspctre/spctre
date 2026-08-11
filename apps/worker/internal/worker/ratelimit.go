package worker

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Runtime ingress backpressure.
//
// The runtime hot paths authenticate by querying the database, validate the
// workspace and policy context, then write. All of that happens before any
// limit is consulted, so a single misbehaving runtime could turn one token into
// sustained database load. That matters most on a small instance, where the
// connection ceiling is reached long before CPU is.
//
// This is a deliberately modest, in-process token bucket keyed on the caller's
// credential. It is not a distributed limiter and does not replace an edge WAF:
// with N worker instances behind a load balancer the effective ceiling is N
// times the configured rate. It exists so that one runaway caller degrades
// itself rather than the database every other tenant shares.
const (
	defaultRateLimitRPS   = 25
	defaultRateLimitBurst = 50

	// Bounds memory for the key table. Beyond this, idle buckets are reclaimed
	// before new ones are admitted so an attacker rotating credentials cannot
	// grow the map without limit.
	rateLimitMaxKeys    = 20_000
	rateLimitIdleExpiry = 10 * time.Minute
)

type tokenBucket struct {
	tokens   float64
	lastFill time.Time
	lastSeen time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket

	rps   float64
	burst float64

	// Observability for /metrics: throttling should be visible without
	// reading logs.
	throttled atomic.Uint64
}

func newRateLimiter(rps, burst float64) *rateLimiter {
	return &rateLimiter{buckets: make(map[string]*tokenBucket), rps: rps, burst: burst}
}

// newRateLimiterFromEnv reads the configured limit. SPCTRE_WORKER_RATE_LIMIT_RPS=0
// disables limiting entirely, which is the correct posture for a deployment
// that already terminates abuse at an edge proxy.
func newRateLimiterFromEnv() *rateLimiter {
	rps := envFloat("SPCTRE_WORKER_RATE_LIMIT_RPS", defaultRateLimitRPS)
	if rps <= 0 {
		return nil
	}
	burst := envFloat("SPCTRE_WORKER_RATE_LIMIT_BURST", defaultRateLimitBurst)
	if burst < rps {
		burst = rps
	}
	return newRateLimiter(rps, burst)
}

func envFloat(name string, fallback float64) float64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return value
}

// allow reports whether the key may proceed, and when it should retry if not.
func (l *rateLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	bucket, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= rateLimitMaxKeys {
			l.evictIdleLocked(now)
		}
		bucket = &tokenBucket{tokens: l.burst, lastFill: now}
		l.buckets[key] = bucket
	}

	// Refill for elapsed time, capped at burst.
	elapsed := now.Sub(bucket.lastFill).Seconds()
	if elapsed > 0 {
		bucket.tokens = math.Min(l.burst, bucket.tokens+elapsed*l.rps)
		bucket.lastFill = now
	}
	bucket.lastSeen = now

	if bucket.tokens >= 1 {
		bucket.tokens--
		return true, 0
	}

	l.throttled.Add(1)
	// Time until one whole token is available again, rounded up to a second so
	// Retry-After is never 0.
	deficit := 1 - bucket.tokens
	wait := max(time.Duration(math.Ceil(deficit/l.rps))*time.Second, time.Second)
	return false, wait
}

// evictIdleLocked drops buckets untouched for longer than rateLimitIdleExpiry.
// If that reclaims nothing (every key is active), the table is cleared: a
// too-permissive moment is preferable to unbounded growth, and an actually
// saturated worker is already shedding load through its own backpressure.
func (l *rateLimiter) evictIdleLocked(now time.Time) {
	for key, bucket := range l.buckets {
		if now.Sub(bucket.lastSeen) > rateLimitIdleExpiry {
			delete(l.buckets, key)
		}
	}
	if len(l.buckets) >= rateLimitMaxKeys {
		l.buckets = make(map[string]*tokenBucket)
	}
}

// rateLimitKey identifies the caller without retaining credential material.
// A bearer token is hashed; anonymous callers fall back to their network
// address so an unauthenticated flood is still bounded.
func rateLimitKey(r *http.Request) string {
	if auth := strings.TrimSpace(r.Header.Get("Authorization")); auth != "" {
		digest := sha256.Sum256([]byte(auth))
		return "t:" + hex.EncodeToString(digest[:8])
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		if first, _, found := strings.Cut(forwarded, ","); found {
			return "ip:" + strings.TrimSpace(first)
		}
		return "ip:" + forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "ip:" + r.RemoteAddr
	}
	return "ip:" + host
}

// rateLimitedPaths are the runtime ingress routes that do database work on
// behalf of an external caller. Health, readiness and metrics must stay
// reachable for probes, and the internal job endpoints are already gated by the
// worker internal secret and driven by a scheduler, not by tenants.
func isRateLimitedPath(path string) bool {
	switch path {
	case "/api/evidence",
		"/api/gateway/decide",
		"/api/gateway/claim",
		"/api/gateway/resolve",
		"/api/gateway-ingest/helicone",
		"/api/gateway-ingest/litellm",
		"/api/gateway-ingest/portkey",
		"/api/trust/ingest",
		"/api/trust/evaluate",
		"/api/trust/context-budget",
		"/api/token/refresh",
		"/api/token/revoke":
		return true
	default:
		return false
	}
}

// throttledRequests reports how many requests this instance has shed. Zero when
// limiting is disabled.
func (s *Server) throttledRequests() uint64 {
	if s.rateLimiter == nil {
		return 0
	}
	return s.rateLimiter.throttled.Load()
}

// throttleRuntimeIngress rejects over-rate callers before body parsing,
// authentication, or any database work — the point of the control.
func (s *Server) throttleRuntimeIngress(next http.Handler) http.Handler {
	if s.rateLimiter == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isRateLimitedPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		allowed, retryAfter := s.rateLimiter.allow(rateLimitKey(r), time.Now())
		if !allowed {
			traceID := r.Header.Get("x-request-id")
			s.logger.Warn("runtime ingress throttled", "path", r.URL.Path, "retry_after_seconds", int(retryAfter.Seconds()))
			w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())))
			writeError(w, http.StatusTooManyRequests, "Too many requests for this credential. Retry after the indicated delay.", traceID, nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}
