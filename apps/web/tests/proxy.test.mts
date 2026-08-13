import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

function makeRequest(
  pathname: string,
  ip: string,
  init?: { method?: string; headers?: Record<string, string>; sessionId?: string },
): NextRequest {
  return {
    method: init?.method ?? "GET",
    headers: new Headers({ "x-forwarded-for": ip, ...(init?.headers ?? {}) }),
    nextUrl: new URL(`https://spctre.test${pathname}`),
    cookies: {
      get: (name: string) =>
        name === "spctre_session_id" && init?.sessionId
          ? { name, value: init.sessionId }
          : undefined,
    },
  } as unknown as NextRequest;
}

describe("proxy rate limiting", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    delete process.env.DATABASE_URL;
    delete process.env.SPCTRE_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.SPCTRE_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.SPCTRE_ALLOWED_SOURCE_IPS;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("returns Retry-After based on the configured rate limit window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_RATE_LIMIT_MAX_REQUESTS = "1";
    process.env.SPCTRE_RATE_LIMIT_WINDOW_SECONDS = "2";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const { proxy } = await import("../proxy");
    const request = makeRequest("/api/evidence", "203.0.113.10");

    await proxy(request);
    const response = await proxy(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    await expect(response.json()).resolves.toEqual({ error: "Too many requests." });
  });

  it("blocks requests outside the configured source IP allowlist", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_ALLOWED_SOURCE_IPS = "198.51.100.7";

    const { proxy } = await import("../proxy");
    const response = await proxy(makeRequest("/login", "203.0.113.10"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden." });
  });

  it("allows configured source IPs through the public login route", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_ALLOWED_SOURCE_IPS = "198.51.100.7";

    const { proxy } = await import("../proxy");
    const response = await proxy(makeRequest("/login", "198.51.100.7"));

    expect(response.status).toBe(200);
  });

  it("lets the checkout surface reach provisioning when the source IP allowlist is enabled", async () => {
    // The checkout surface calls this from its own infrastructure, never from
    // an operator address, and the route authenticates the shared secret
    // itself. Blocking it here left paid signups unprovisioned.
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_ALLOWED_SOURCE_IPS = "198.51.100.7";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/internal/provisioning/tenant", "203.0.113.10", {
        method: "POST",
        headers: { authorization: "Bearer provisioning-secret" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("lets Paddle reach the billing webhook, which verifies its own signature", async () => {
    // The allowlist exemption alone is not enough: Paddle sends no session
    // cookie, so the session gate answered 401 and the route's signature
    // verification never ran.
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_ALLOWED_SOURCE_IPS = "198.51.100.7";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/billing/paddle/webhook", "203.0.113.10", {
        method: "POST",
        headers: { "paddle-signature": "ts=1;h1=abc" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("still blocks other internal routes outside the source IP allowlist", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_ALLOWED_SOURCE_IPS = "198.51.100.7";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/internal/archive-evidence", "203.0.113.10", {
        method: "POST",
        headers: { authorization: "Bearer worker-secret" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("keeps readiness available when the source IP allowlist is enabled", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";
    process.env.SPCTRE_ALLOWED_SOURCE_IPS = "198.51.100.7";

    const { proxy } = await import("../proxy");
    const response = await proxy(makeRequest("/api/ready", "203.0.113.10"));

    expect(response.status).toBe(200);
  });

  it("passes SCIM bearer requests through to the versioned route", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/v1/scim/v2/Users", "203.0.113.10", {
        headers: { authorization: "Bearer scim-token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("passes policy imports through to their bearer-authenticated route", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/v1/policy/imports", "203.0.113.10", {
        method: "POST",
        headers: { authorization: "Bearer policy-import-token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("passes Blueprint runtime fetches through to their route handler", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/agent-blueprints/runtime?agentId=scout", "203.0.113.10"),
    );

    expect(response.status).toBe(200);
  });

  it("passes MCP policy fetches through to their bearer-authenticated route", async () => {
    // The MCP server loads its governed tool and connector registry with a
    // bundle:read service token and no session cookie. Missing from the
    // service path set, the session gate answered 401 before the route ran,
    // and the failure was invisible: the server caches the failed load and
    // falls back to its env-var allowlists, so it kept serving tools with no
    // registry behind them.
    process.env.DATABASE_URL = "postgres://spctre.test/app";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/workspace/mcp-policy?agentId=scout", "203.0.113.10", {
        headers: { authorization: "Bearer mcp-token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects cookie-authenticated mutations from a mismatched origin", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/workspace/normalize", "203.0.113.10", {
        method: "POST",
        sessionId: "session-1",
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request origin." });
  });

  it("allows cookie-authenticated mutations from the forwarded public origin", async () => {
    process.env.DATABASE_URL = "postgres://spctre.test/app";

    const { proxy } = await import("../proxy");
    const response = await proxy(
      makeRequest("/api/workspace/normalize", "203.0.113.10", {
        method: "POST",
        sessionId: "session-1",
        headers: {
          origin: "https://spctre-staging-web-fyow2cpb6q-uc.a.run.app",
          "x-forwarded-host": "spctre-staging-web-fyow2cpb6q-uc.a.run.app",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.status).not.toBe(403);
  });
});
