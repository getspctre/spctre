package worker

// notifications_transport.go holds the outbound-notification transport
// primitives shared by both dispatch paths: the custom-alerting-rule delivery
// (jobs_notification_delivery.go) and the gateway escalation delivery
// (gateway.go). Before this, each path inlined its own PagerDuty routing
// resolution and its own HTTP POST/timeout/status plumbing, so adding a
// provider or touching the wire protocol meant synchronized edits in two
// places. This is the shared collapse called out as Hotspot 2 in the
// maintainability-complexity audit. Message *formatting* still lives with each
// path, because the alert and escalation payloads are genuinely different
// documents; only the transport is shared.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// resolvePagerDutyRouting derives the Events API v2 routing key and the endpoint
// URL from a configured integration URL and optional JSON config. If the URL is
// not itself an http(s) URL it is treated as a bare routing key and the request
// is sent to the public PagerDuty enqueue endpoint. An explicit
// config.routingKey always wins; an http(s) URL used as a routing key falls back
// to "default".
func resolvePagerDutyRouting(url string, configBytes []byte) (routingKey, endpoint string) {
	routingKey = url
	if len(configBytes) > 0 {
		var cfg map[string]any
		if err := json.Unmarshal(configBytes, &cfg); err == nil {
			if rk, ok := cfg["routingKey"].(string); ok && rk != "" {
				routingKey = rk
			}
		}
	}
	if strings.HasPrefix(routingKey, "http://") || strings.HasPrefix(routingKey, "https://") {
		routingKey = "default"
	}
	endpoint = url
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		endpoint = "https://events.pagerduty.com/v2/enqueue"
	}
	return routingKey, endpoint
}

// deliverJSONNotification POSTs a JSON body to url with the standard Spctre
// notification headers and a bounded timeout, returning an *httpStatusError for
// non-2xx responses. Extra headers (e.g. Splunk/Sentinel auth) are applied last
// and may override the defaults.
func deliverJSONNotification(ctx context.Context, client notificationHTTPClient, url string, body []byte, timeout time.Duration, extraHeaders map[string]string) error {
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "spctre-worker-notifications/1")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &httpStatusError{status: resp.StatusCode, msg: "notification delivery"}
	}
	return nil
}
