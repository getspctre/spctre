import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_SUBRESOURCE_PATH,
  EVIDENCE_BY_DECISION_PATH,
  APPROVAL_BY_ID_PATH,
  BILLING_WEBHOOK_PATH,
  MACHINE_API_PATH_PATTERNS,
  MACHINE_API_PATHS,
  PRE_AUTH_BOOTSTRAP_PATHS,
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

  // The machine API is excused from the source-IP allowlist. That is the same
  // shape of exemption as the two above, so it carries the same obligation --
  // and two more, because this set is what decides that a path is safe on the
  // open internet.
  it("keeps every machine API path reachable past the session gate", () => {
    const stranded = [...MACHINE_API_PATHS].filter(
      (pathname) => !reachablePastSessionGate(pathname),
    );

    expect(stranded).toEqual([]);
  });

  it("never puts a pre-auth bootstrap path on the machine API", () => {
    // These are reachable without a session because no credential exists yet.
    // Excusing them from the allowlist too would expose an unauthenticated
    // write to anyone: /api/onboarding/cli/start takes a body and inserts a row.
    const overlap = [...PRE_AUTH_BOOTSTRAP_PATHS].filter((pathname) =>
      MACHINE_API_PATHS.has(pathname),
    );

    expect(overlap).toEqual([]);
  });

  it("keeps the e2e policy routes off the machine API", () => {
    // Their only guard is SPCTRE_E2E_API_ENABLED. The allowlist is the second
    // layer that keeps a misconfigured flag from becoming anonymous policy
    // publish, so it has to stay in front of them.
    const exposed = [...MACHINE_API_PATHS].filter((pathname) => pathname.startsWith("/api/e2e/"));

    expect(exposed).toEqual([]);
  });

  it("only admits API paths to the machine API", () => {
    const nonApi = [...MACHINE_API_PATHS].filter((pathname) => !pathname.startsWith("/api/"));

    expect(nonApi).toEqual([]);
  });

  // The id-carrying members are patterns, so the reachability obligation is
  // asserted on paths that exercise them rather than on a list.
  it("keeps pattern-matched machine API paths reachable past the session gate", () => {
    for (const pathname of [
      "/api/agents/scout/audit",
      "/api/agents/outreach/trust-history",
      "/api/agents/author/identity-history",
      "/api/agents/scout/surfaces",
      "/api/approvals/01J8Z6C2Q9",
    ]) {
      expect(
        MACHINE_API_PATH_PATTERNS.some((pattern) => pattern.test(pathname)),
        pathname,
      ).toBe(true);
      expect(reachablePastSessionGate(pathname), pathname).toBe(true);
    }
  });

  it("confines the agent pattern to the named subresources", () => {
    // A prefix would have granted these too. Writes and future subresources
    // stay behind the allowlist until someone names them.
    for (const pathname of [
      "/api/agents/scout",
      "/api/agents/scout/audit/export",
      "/api/agents/scout/delete",
      "/api/agents//audit",
      "/api/agents/scout/surfaces/surface-1",
    ]) {
      expect(AGENT_SUBRESOURCE_PATH.test(pathname), pathname).toBe(false);
    }
  });

  it("confines the approval pattern to a single id segment", () => {
    for (const pathname of ["/api/approvals", "/api/approvals/abc/decide", "/api/approvals//"]) {
      expect(APPROVAL_BY_ID_PATH.test(pathname), pathname).toBe(false);
    }
  });

  // decision_id is text, so the evidence id cannot be constrained by shape and
  // the static siblings are excluded by name. A name list falls behind the
  // directory it describes, so read the directory.
  it("never lets the evidence id pattern swallow a sibling route", () => {
    const evidenceDir = join(process.cwd(), "app", "api", "evidence");
    const siblings = readdirSync(evidenceDir).filter((entry) =>
      statSync(join(evidenceDir, entry)).isDirectory(),
    );

    const swallowed = siblings
      .filter((entry) => !entry.startsWith("["))
      .filter((entry) => EVIDENCE_BY_DECISION_PATH.test(`/api/evidence/${entry}`));

    expect(swallowed).toEqual([]);
  });

  it("matches an actual decision id", () => {
    // The exclusions must not be so broad that the route they guard stops
    // matching. decision_id is free-form text, not a uuid.
    for (const id of ["dec-1", "01J8Z6C2Q9", "3f8a1c22-0b7e-4d19-9a3c-7c1f2e5d6b40"]) {
      expect(EVIDENCE_BY_DECISION_PATH.test(`/api/evidence/${id}`), id).toBe(true);
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
