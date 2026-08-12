import { describe, expect, it } from "vitest";
import {
  BILLING_WEBHOOK_PATH,
  PUBLIC_PATH_PREFIXES,
  PUBLIC_PATHS,
  SELF_AUTHENTICATING_PATHS,
  SELF_AUTHENTICATING_PATH_PATTERNS,
  SERVICE_API_PATH_PREFIXES,
  SERVICE_API_PATHS,
  SERVICE_API_PATH_PATTERNS,
} from "@/lib/proxy-paths";

function reachablePastSessionGate(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    SERVICE_API_PATHS.has(pathname) ||
    SERVICE_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    SERVICE_API_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

describe("proxy path invariants", () => {
  // The proxy applies two independent gates: a source-IP allowlist, and a
  // session check that answers 401 for any /api/ path that is not a service
  // path. Excusing an endpoint from the first without the second produces a
  // failure that looks handled — the exemption is right there in the code —
  // and it has happened three times: the billing webhook, the internal
  // provisioning API, and once before that.
  it("keeps every allowlist-exempt path reachable past the session gate", () => {
    const stranded = [...SELF_AUTHENTICATING_PATHS].filter(
      (pathname) => !reachablePastSessionGate(pathname),
    );

    expect(stranded).toEqual([]);
  });

  it("only exempts API paths, which is the surface the allowlist guards", () => {
    const nonApi = [...SELF_AUTHENTICATING_PATHS].filter(
      (pathname) => !pathname.startsWith("/api/"),
    );

    expect(nonApi).toEqual([]);
  });

  // A pattern cannot be enumerated, so the same relationship is asserted on
  // the pattern itself and on paths that exercise its edges. The billing
  // webhook is exempt from the source-IP allowlist because a payment
  // provider's fleet will never be an operator address; it must therefore also
  // be reachable past the session gate, or it answers 401 to every delivery.
  it("keeps the billing webhook exempt from both gates, for any provider", () => {
    expect(SELF_AUTHENTICATING_PATH_PATTERNS).toContain(BILLING_WEBHOOK_PATH);
    expect(SERVICE_API_PATH_PATTERNS).toContain(BILLING_WEBHOOK_PATH);

    for (const pathname of ["/api/billing/paddle/webhook", "/api/billing/stripe/webhook"]) {
      expect(reachablePastSessionGate(pathname), pathname).toBe(true);
      expect(
        SELF_AUTHENTICATING_PATH_PATTERNS.some((pattern) => pattern.test(pathname)),
        pathname,
      ).toBe(true);
    }
  });

  // The exemption belongs to the webhook, not to everything under /api/billing.
  it("does not exempt a sibling billing path", () => {
    for (const pathname of [
      "/api/billing/paddle/webhook/replay",
      "/api/billing/paddle/subscriptions",
      "/api/billing//webhook",
      "/api/billing/webhook",
    ]) {
      expect(BILLING_WEBHOOK_PATH.test(pathname), pathname).toBe(false);
    }
  });

  it("does not exempt a path that a browser session would also reach", () => {
    // A self-authenticating endpoint answers to a credential, never to a
    // cookie. Overlap with the public set would mean it is reachable for a
    // reason other than the one claimed.
    const alsoPublic = [...SELF_AUTHENTICATING_PATHS].filter((pathname) =>
      PUBLIC_PATHS.has(pathname),
    );

    expect(alsoPublic).toEqual([]);
  });
});
