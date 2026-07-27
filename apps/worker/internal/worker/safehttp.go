package worker

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"
)

// isBlockedIP reports whether ip is a loopback, private, link-local, unique
// local, CGNAT, unspecified, or cloud-metadata address that outbound webhook
// traffic must never reach.
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	// Cloud metadata endpoint (also covered by IsLinkLocalUnicast, kept explicit).
	if ip.Equal(net.IPv4(169, 254, 169, 254)) {
		return true
	}
	// RFC 6598 carrier-grade NAT 100.64.0.0/10.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return true
	}
	return false
}

// safeDialControl runs after DNS resolution, immediately before the socket
// connects, and receives the concrete resolved address. Rejecting blocked IPs
// here validates the initial request and every redirect hop, which closes the
// DNS-rebinding / time-of-check-time-of-use gap.
func safeDialControl(_ string, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("safe dial: could not parse address %q: %w", address, err)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("safe dial: could not parse IP %q", host)
	}
	if isBlockedIP(ip) {
		return fmt.Errorf("safe dial: blocked SSRF target %s", ip)
	}
	return nil
}

// newSafeHTTPClient builds an http.Client for fetching user-supplied
// (webhook / SIEM) destinations. Every dial — including redirect hops — is
// validated against isBlockedIP via the dialer Control hook.
func newSafeHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   safeDialControl,
	}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("stopped after 5 redirects")
			}
			return nil
		},
	}
}

// safeHTTPClient is the shared, SSRF-guarded client for outbound delivery to
// user-configured destinations (alerting integrations, SIEM streams). It must
// NOT be used for calls to internal Spctre services (those are trusted and may
// legitimately resolve to private addresses).
var safeHTTPClient = newSafeHTTPClient(15 * time.Second)

// constantTimeSecretMatch compares two secrets without leaking length-timing
// information beyond the fact that the lengths differ.
func constantTimeSecretMatch(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
