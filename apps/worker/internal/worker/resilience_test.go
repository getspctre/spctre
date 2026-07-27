package worker

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestIsTransientSendError(t *testing.T) {
	cases := []struct {
		name      string
		err       error
		transient bool
	}{
		{"nil", nil, false},
		{"context canceled", context.Canceled, false},
		{"network error", errors.New("dial tcp: connection refused"), true},
		{"http 500", &httpStatusError{status: 500, msg: "x"}, true},
		{"http 502", &httpStatusError{status: 502, msg: "x"}, true},
		{"http 429", &httpStatusError{status: 429, msg: "x"}, true},
		{"http 408", &httpStatusError{status: 408, msg: "x"}, true},
		{"http 400", &httpStatusError{status: 400, msg: "x"}, false},
		{"http 401", &httpStatusError{status: 401, msg: "x"}, false},
		{"http 404", &httpStatusError{status: 404, msg: "x"}, false},
	}
	for _, tc := range cases {
		if got := isTransientSendError(tc.err); got != tc.transient {
			t.Errorf("%s: expected transient=%v, got %v", tc.name, tc.transient, got)
		}
	}
}

func TestSendWithRetryRecoversFromTransientFailure(t *testing.T) {
	attempts := 0
	err := sendWithRetry(context.Background(), 3, time.Millisecond, func(context.Context) error {
		attempts++
		if attempts < 3 {
			return &httpStatusError{status: 503, msg: "flaky"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected recovery, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestSendWithRetryStopsOnPermanentError(t *testing.T) {
	attempts := 0
	err := sendWithRetry(context.Background(), 3, time.Millisecond, func(context.Context) error {
		attempts++
		return &httpStatusError{status: 401, msg: "bad auth"}
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if attempts != 1 {
		t.Fatalf("permanent error must not be retried; got %d attempts", attempts)
	}
}

func TestSendWithRetryExhaustsTransientFailures(t *testing.T) {
	attempts := 0
	err := sendWithRetry(context.Background(), 3, time.Millisecond, func(context.Context) error {
		attempts++
		return &httpStatusError{status: 502, msg: "down"}
	})
	if err == nil {
		t.Fatal("expected error after exhausting attempts")
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestBreakerOpensAfterThresholdAndRecovers(t *testing.T) {
	now := time.Now()
	reg := newBreakerRegistry(3, time.Minute)
	reg.now = func() time.Time { return now }

	host := "hooks.example.test"

	// Below threshold: still allowed.
	for i := 0; i < 2; i++ {
		if !reg.allow(host) {
			t.Fatalf("breaker must stay closed below threshold (failure %d)", i)
		}
		reg.record(host, false)
	}
	if !reg.allow(host) {
		t.Fatal("breaker must stay closed at threshold-1")
	}
	reg.record(host, false) // third consecutive failure → open

	if reg.allow(host) {
		t.Fatal("breaker must reject while open")
	}

	// Cooldown elapses → half-open admits exactly one probe.
	now = now.Add(61 * time.Second)
	if !reg.allow(host) {
		t.Fatal("breaker must admit a half-open probe after cooldown")
	}
	if reg.allow(host) {
		t.Fatal("breaker must admit only one half-open probe")
	}

	// Probe succeeds → closed again.
	reg.record(host, true)
	if !reg.allow(host) {
		t.Fatal("breaker must close after successful probe")
	}
}

func TestBreakerReopensOnFailedProbe(t *testing.T) {
	now := time.Now()
	reg := newBreakerRegistry(1, time.Minute)
	reg.now = func() time.Time { return now }

	host := "hooks.example.test"
	reg.record(host, false) // threshold 1 → open immediately
	if reg.allow(host) {
		t.Fatal("breaker must be open")
	}

	now = now.Add(2 * time.Minute)
	if !reg.allow(host) {
		t.Fatal("expected half-open probe")
	}
	reg.record(host, false) // failed probe → open again for a fresh cooldown

	now = now.Add(30 * time.Second)
	if reg.allow(host) {
		t.Fatal("breaker must stay open for a fresh cooldown after a failed probe")
	}
}

func TestBreakerIsPerHost(t *testing.T) {
	reg := newBreakerRegistry(1, time.Minute)
	reg.record("down.example.test", false)
	if reg.allow("down.example.test") {
		t.Fatal("failing host must be open")
	}
	if !reg.allow("healthy.example.test") {
		t.Fatal("other hosts must be unaffected")
	}
}

func TestDeliverWithResilienceSkipsWhenBreakerOpen(t *testing.T) {
	reg := newBreakerRegistry(1, time.Minute)
	reg.record("hooks.example.test", false)

	calls := 0
	err := deliverWithResilience(context.Background(), reg, "https://hooks.example.test/alert", func(context.Context) error {
		calls++
		return nil
	})
	if !errors.Is(err, errBreakerOpen) {
		t.Fatalf("expected errBreakerOpen, got %v", err)
	}
	if calls != 0 {
		t.Fatal("send must not be attempted while breaker is open")
	}
}

func TestHostForBreaker(t *testing.T) {
	cases := map[string]string{
		"https://hooks.slack.com/services/T0/B0/x": "hooks.slack.com",
		"https://Example.com:8443/webhook":         "example.com:8443",
		"https://events.pagerduty.com/v2/enqueue":  "events.pagerduty.com",
		// Sentinel integrations store a workspace UUID, not a URL; it still
		// gets a stable per-destination breaker key.
		"1b2c3d4e-0000-0000-0000-000000000000": "1b2c3d4e-0000-0000-0000-000000000000",
	}
	for endpoint, want := range cases {
		if got := hostForBreaker(endpoint); got != want {
			t.Errorf("hostForBreaker(%q) = %q, want %q", endpoint, got, want)
		}
	}
}
