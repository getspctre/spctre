package worker

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net/url"
	"strings"
	"sync"
	"time"
)

// httpStatusError carries the response status so callers can distinguish
// transient failures (retry-worthy) from permanent rejections.
type httpStatusError struct {
	status int
	msg    string
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("%s returned HTTP %d", e.msg, e.status)
}

// isTransientSendError reports whether a delivery failure is worth retrying:
// network/timeout errors and 408/429/5xx responses are transient; other HTTP
// rejections (bad auth, bad payload) are permanent and retrying cannot help.
func isTransientSendError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if statusErr, ok := errors.AsType[*httpStatusError](err); ok {
		return statusErr.status == 408 || statusErr.status == 429 || statusErr.status >= 500
	}
	// Anything that never produced an HTTP response (DNS, connect, TLS,
	// timeout) is transient by nature.
	return true
}

// sendWithRetry runs send up to attempts times, sleeping with jittered
// exponential backoff between tries. Permanent errors and parent-context
// cancellation stop the loop immediately.
func sendWithRetry(ctx context.Context, attempts int, baseDelay time.Duration, send func(context.Context) error) error {
	if attempts < 1 {
		attempts = 1
	}
	var err error
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			delay := baseDelay << (attempt - 1)
			jittered := time.Duration(float64(delay) * (0.5 + rand.Float64()))
			select {
			case <-time.After(jittered):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		err = send(ctx)
		if err == nil || !isTransientSendError(err) || ctx.Err() != nil {
			return err
		}
	}
	return err
}

// errBreakerOpen signals that delivery was skipped, not attempted. Callers
// must treat it as "try again next sweep", never as a delivery failure.
var errBreakerOpen = errors.New("circuit breaker open")

type breakerState int

const (
	breakerClosed breakerState = iota
	breakerOpen
	breakerHalfOpen
)

type circuitBreaker struct {
	state               breakerState
	consecutiveFailures int
	openedAt            time.Time
}

// breakerRegistry keeps one circuit breaker per destination host. A breaker
// opens after failureThreshold consecutive failures, rejects calls for
// cooldown, then admits a single half-open probe: success closes it, failure
// re-opens it for another cooldown.
type breakerRegistry struct {
	mu               sync.Mutex
	breakers         map[string]*circuitBreaker
	failureThreshold int
	cooldown         time.Duration
	now              func() time.Time
}

func newBreakerRegistry(failureThreshold int, cooldown time.Duration) *breakerRegistry {
	return &breakerRegistry{
		breakers:         map[string]*circuitBreaker{},
		failureThreshold: failureThreshold,
		cooldown:         cooldown,
		now:              time.Now,
	}
}

// allow reports whether a call to host may proceed. When the cooldown of an
// open breaker has elapsed it transitions to half-open and admits exactly one
// probe; concurrent callers keep being rejected until record() settles it.
func (r *breakerRegistry) allow(host string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.breakers[host]
	if !ok {
		return true
	}
	switch b.state {
	case breakerClosed:
		return true
	case breakerOpen:
		if r.now().Sub(b.openedAt) >= r.cooldown {
			b.state = breakerHalfOpen
			return true
		}
		return false
	default: // half-open: a probe is already in flight
		return false
	}
}

func (r *breakerRegistry) record(host string, success bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.breakers[host]
	if !ok {
		b = &circuitBreaker{}
		r.breakers[host] = b
	}
	if success {
		b.state = breakerClosed
		b.consecutiveFailures = 0
		return
	}
	b.consecutiveFailures++
	if b.state == breakerHalfOpen || b.consecutiveFailures >= r.failureThreshold {
		b.state = breakerOpen
		b.openedAt = r.now()
	}
}

// hostForBreaker reduces an endpoint to its breaker key. Unparseable
// endpoints share a key so they still get breaker protection.
func hostForBreaker(endpoint string) string {
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		return strings.ToLower(u.Host)
	}
	return strings.ToLower(strings.TrimSpace(endpoint))
}

const (
	outboundBreakerFailureThreshold = 3
	outboundBreakerCooldown         = 60 * time.Second
	outboundRetryAttempts           = 3
	outboundRetryBaseDelay          = 500 * time.Millisecond
)

// outboundBreakers guards every user-configured delivery destination
// (alerting integrations, SIEM streams, the global notification webhook).
var outboundBreakers = newBreakerRegistry(outboundBreakerFailureThreshold, outboundBreakerCooldown)

// deliverWithResilience is the standard wrapper for outbound delivery to
// user-configured endpoints: per-host circuit breaker around jittered
// exponential-backoff retries. Returns errBreakerOpen (delivery skipped)
// when the destination is cooling down.
func deliverWithResilience(ctx context.Context, breakers *breakerRegistry, endpoint string, send func(context.Context) error) error {
	host := hostForBreaker(endpoint)
	if !breakers.allow(host) {
		return errBreakerOpen
	}
	err := sendWithRetry(ctx, outboundRetryAttempts, outboundRetryBaseDelay, send)
	breakers.record(host, err == nil)
	return err
}
