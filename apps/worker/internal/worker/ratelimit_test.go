package worker

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestRateLimiterAllowsBurstThenSheds(t *testing.T) {
	limiter := newRateLimiter(10, 3)
	now := time.Now()

	for i := 0; i < 3; i++ {
		if allowed, _ := limiter.allow("t:abc", now); !allowed {
			t.Fatalf("request %d within burst should be allowed", i+1)
		}
	}

	allowed, retryAfter := limiter.allow("t:abc", now)
	if allowed {
		t.Fatal("request beyond burst should be shed")
	}
	if retryAfter < time.Second {
		t.Fatalf("Retry-After must be at least one second, got %s", retryAfter)
	}
	if got := limiter.throttled.Load(); got != 1 {
		t.Fatalf("expected one throttled request, got %d", got)
	}
}

func TestRateLimiterRefillsOverTime(t *testing.T) {
	limiter := newRateLimiter(10, 2)
	now := time.Now()

	limiter.allow("t:abc", now)
	limiter.allow("t:abc", now)
	if allowed, _ := limiter.allow("t:abc", now); allowed {
		t.Fatal("bucket should be empty")
	}

	// 10 rps means one token every 100ms.
	if allowed, _ := limiter.allow("t:abc", now.Add(150*time.Millisecond)); !allowed {
		t.Fatal("bucket should have refilled after 150ms")
	}
}

func TestRateLimiterIsolatesKeys(t *testing.T) {
	limiter := newRateLimiter(10, 1)
	now := time.Now()

	if allowed, _ := limiter.allow("t:one", now); !allowed {
		t.Fatal("first key should be allowed")
	}
	if allowed, _ := limiter.allow("t:one", now); allowed {
		t.Fatal("first key should now be shed")
	}
	if allowed, _ := limiter.allow("t:two", now); !allowed {
		t.Fatal("a different credential must not inherit another's throttling")
	}
}

func TestRateLimiterEvictsIdleKeys(t *testing.T) {
	limiter := newRateLimiter(10, 1)
	start := time.Now()
	limiter.allow("t:idle", start)

	limiter.mu.Lock()
	limiter.evictIdleLocked(start.Add(rateLimitIdleExpiry + time.Minute))
	remaining := len(limiter.buckets)
	limiter.mu.Unlock()

	if remaining != 0 {
		t.Fatalf("idle bucket should have been reclaimed, %d remain", remaining)
	}
}

func TestRateLimitKeyPrefersCredentialOverAddress(t *testing.T) {
	withToken := httptest.NewRequest(http.MethodPost, "/api/evidence", nil)
	withToken.Header.Set("Authorization", "Bearer secret-value")
	key := rateLimitKey(withToken)
	if key == "" || key[:2] != "t:" {
		t.Fatalf("expected a credential-derived key, got %q", key)
	}
	// The raw credential must not survive into the key table.
	if strings.Contains(key, "secret-value") {
		t.Fatalf("rate limit key leaked credential material: %q", key)
	}

	anonymous := httptest.NewRequest(http.MethodPost, "/api/evidence", nil)
	anonymous.Header.Set("X-Forwarded-For", "203.0.113.7, 70.41.3.18")
	if got := rateLimitKey(anonymous); got != "ip:203.0.113.7" {
		t.Fatalf("expected the client address from X-Forwarded-For, got %q", got)
	}
}

func TestRateLimitedPathsExcludeProbesAndInternalJobs(t *testing.T) {
	for _, path := range []string{"/api/evidence", "/api/gateway/decide", "/api/trust/ingest"} {
		if !isRateLimitedPath(path) {
			t.Fatalf("%s is runtime ingress and must be rate limited", path)
		}
	}
	// Probes must stay reachable while shedding, and internal job endpoints are
	// gated by the worker internal secret and driven by a scheduler.
	for _, path := range []string{"/health", "/healthz", "/ready", "/readyz", "/metrics", "/internal/jobs/retention-sweep"} {
		if isRateLimitedPath(path) {
			t.Fatalf("%s must not be rate limited", path)
		}
	}
}

func TestThrottleMiddlewareShedsWith429AndRetryAfter(t *testing.T) {
	s := &Server{logger: discardLogger(), rateLimiter: newRateLimiter(1, 1)}
	handler := s.throttleRuntimeIngress(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/evidence", nil)
		r.Header.Set("Authorization", "Bearer token")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}

	if got := request().Code; got != http.StatusOK {
		t.Fatalf("first request should pass, got %d", got)
	}
	shed := request()
	if shed.Code != http.StatusTooManyRequests {
		t.Fatalf("second request should be shed with 429, got %d", shed.Code)
	}
	if shed.Header().Get("Retry-After") == "" {
		t.Fatal("a shed response must carry Retry-After")
	}
}

func TestThrottleMiddlewareIsPassThroughWhenDisabled(t *testing.T) {
	s := &Server{logger: discardLogger(), rateLimiter: nil}
	called := 0
	handler := s.throttleRuntimeIngress(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 5; i++ {
		r := httptest.NewRequest(http.MethodPost, "/api/evidence", nil)
		handler.ServeHTTP(httptest.NewRecorder(), r)
	}
	if called != 5 {
		t.Fatalf("disabling the limiter must not shed anything, handler ran %d times", called)
	}
}
