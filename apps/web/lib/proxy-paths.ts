// Path sets used by the proxy's request gates.
//
// These live outside proxy.ts so the invariant between them can be asserted in
// a test: the proxy applies two independent gates, and an endpoint excused from
// one but not the other fails in a way that looks like it was handled. That
// mistake has been made three times — the billing webhook, the internal
// provisioning API, and once more before it — so the relationship is encoded
// here rather than left to reviewers to notice.
//
// Deliberately free of imports: proxy.ts runs on the edge runtime.

export const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/api/auth/oidc/authorize",
  "/api/auth/oidc/callback",
  "/icon.svg",
  "/favicon.ico",
  "/llms.txt",
  "/llms-full.txt",
]);

export const PUBLIC_PATH_PREFIXES = ["/login/", "/signup/"];

// Endpoints that authenticate every request themselves — bearer token, shared
// secret, or signature — rather than relying on a browser session.
export const SERVICE_API_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/evidence",
  "/api/v1/evidence",
  "/api/bundle/latest",
  "/api/v1/bundle/latest",
  "/api/agent-blueprints/runtime",
  "/api/compliance/export",
  "/api/v1/compliance/export",
  "/api/gateway/decide",
  "/api/v1/gateway/decide",
  "/api/gateway/escalations",
  "/api/v1/gateway/escalations",
  "/api/gateway/escalations/status",
  "/api/v1/gateway/escalations/status",
  "/api/verification",
  "/api/v1/verification",
  "/api/v1/openapi.json",
  "/api/v1/policy/imports",
  "/api/v1/blueprint/imports",
  "/api/compliance/seal",
  "/api/internal/provisioning/tenant",
  "/api/token/refresh",
  "/api/v1/token/refresh",
  "/api/token/revoke",
  "/api/v1/token/revoke",
  "/api/search",
]);

export const SERVICE_API_PATH_PREFIXES = [
  "/api/e2e/",
  "/api/scim/v2/",
  "/api/v1/scim/v2/",
  "/api/gateway-ingest/",
  "/api/agents/",
  "/api/onboarding/cli/",
];

// Callers whose source address is not an operator address and never will be:
// a payment provider's fleet, or another of our own services reaching this one
// over the internet. They are excused from the source-IP allowlist because that
// allowlist is not what protects them — each verifies its own credential.
//
// Every entry must also be reachable past the session gate, which is what
// `proxy-path-invariants.test.mts` enforces.
export const SELF_AUTHENTICATING_PATHS = new Set(["/api/internal/provisioning/tenant"]);

/**
 * The inbound billing webhook, whose path carries the provider as a segment
 * because verifying a delivery is a commercial slot's job.
 *
 * One constant, referenced by both gates, so the pair cannot drift: an endpoint
 * excused from the source-IP allowlist but stranded behind the session gate
 * fails in a way that looks handled. Matching is anchored — `/webhook` must end
 * the path — so no sibling billing route inherits the exemption.
 */
export const BILLING_WEBHOOK_PATH = /^\/api\/billing\/[a-z0-9-]{1,32}\/webhook$/;

/** Path families reachable past the session gate, matched by pattern. */
export const SERVICE_API_PATH_PATTERNS = [BILLING_WEBHOOK_PATH];

/** Path families excused from the source-IP allowlist, matched by pattern. */
export const SELF_AUTHENTICATING_PATH_PATTERNS = [BILLING_WEBHOOK_PATH];

// Always reachable, so an unhealthy deployment can still be diagnosed.
export const HEALTH_PATHS = new Set(["/api/health", "/api/ready"]);
