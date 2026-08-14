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

/**
 * The published API surface. `packages/api-contracts` declares
 * `servers: [{ url: "/api/v1" }]` with a global `security: [{ bearerAuth: [] }]`,
 * so every path under this prefix is, by its own contract, a bearer-authenticated
 * endpoint that customers and generated SDKs call from their own networks.
 *
 * It is therefore excused from both proxy gates, and it is the one place a
 * prefix is used for that rather than an exact path. What makes a prefix safe
 * here is that nothing can reach this surface unreviewed:
 * `public-api-contract.test.mts` asserts the spec and `app/api/v1` agree in
 * both directions, so adding a route under `/api/v1` without documenting it
 * fails CI. Elsewhere — see MACHINE_API_PATHS — exact paths are used precisely
 * because no such guard exists.
 */
export const PUBLIC_API_PREFIX = "/api/v1/";

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
  "/api/workspace/mcp-policy",
  "/api/approvals/queue",
  "/api/compliance/status",
  "/api/members",
  "/api/workflow/config",
  "/api/workspaces",
]);

export const SERVICE_API_PATH_PREFIXES = [
  "/api/e2e/",
  "/api/scim/v2/",
  "/api/v1/scim/v2/",
  "/api/gateway-ingest/",
  "/api/agents/",
  "/api/onboarding/cli/",
  // The published API. See PUBLIC_API_PREFIX.
  PUBLIC_API_PREFIX,
];

// The machine API: endpoints that verify a credential of their own on every
// request AND are meant to be reached from wherever an agent, SDK, or MCP
// server happens to run. The source-IP allowlist exists to keep the operator
// console on operator networks; it was never what protected these, and
// applying it to them makes the control plane unable to serve its own clients.
//
// This is deliberately NOT `SERVICE_API_PATHS`. That set answers a different
// question — "may this proceed without a session cookie?" — and its members
// include pre-auth bootstrap paths (`/api/onboarding/cli/start` accepts an
// unauthenticated body) and the e2e policy routes, whose only guard is the
// SPCTRE_E2E_API_ENABLED flag. Reusing it here would put both on the open
// internet and reduce the e2e routes to a single boolean's worth of
// protection. The two sets overlap; they are not the same judgement.
//
// Enumerated exactly, with no prefix matching, so the set fails closed: a
// route added under some future `/api/agents/...` path is IP-restricted until
// someone deliberately lists it here.
export const MACHINE_API_PATHS = new Set([
  "/api/evidence",
  "/api/v1/evidence",
  "/api/bundle/latest",
  "/api/v1/bundle/latest",
  "/api/gateway/decide",
  "/api/v1/gateway/decide",
  "/api/gateway/escalations",
  "/api/v1/gateway/escalations",
  "/api/gateway/escalations/status",
  "/api/v1/gateway/escalations/status",
  "/api/gateway-ingest/mcp",
  "/api/verification",
  "/api/v1/verification",
  "/api/agent-blueprints/runtime",
  "/api/workspace/mcp-policy",
  "/api/approvals/queue",
  "/api/compliance/status",
  "/api/members",
  "/api/workflow/config",
  "/api/workspaces",
  // Long-lived clients rotate their own credential; without these a governed
  // agent runs only until its access token expires.
  "/api/token/refresh",
  "/api/v1/token/refresh",
  "/api/token/revoke",
  "/api/v1/token/revoke",
]);

/**
 * Path families excused from the source-IP allowlist by prefix.
 *
 * Only the published API qualifies, for the reason given on PUBLIC_API_PREFIX:
 * it is contract-bound to accept a bearer credential and CI enforces that its
 * membership is reviewed. Do not add a prefix here without an equivalent guard.
 */
export const MACHINE_API_PATH_PREFIXES = [PUBLIC_API_PREFIX];

// Pre-auth bootstrap: reachable without a session because no credential exists
// yet, which is exactly why they must never join the machine API. Named here so
// the invariant test can assert the two sets stay disjoint.
export const PRE_AUTH_BOOTSTRAP_PATHS = new Set([
  "/api/onboarding/cli/start",
  "/api/onboarding/cli/exchange",
]);

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
