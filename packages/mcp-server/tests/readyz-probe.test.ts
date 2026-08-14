import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { UPSTREAM_HEALTH_PATH } from "../src/transport.js";

// Readiness probes the control plane. Which path it probes matters, because the
// control plane applies a source-IP allowlist to everything that is not a health
// path: this server runs on a platform that egresses from an address no operator
// allowlist can contain, so probing the application root answered 403 and
// readiness reported the upstream unreachable while it was serving this server's
// requests normally.
//
// A real upstream is stood up here rather than mocked, because the defect was
// not in how a failure is handled — it was in which URL was asked for.

let upstream: Server | undefined;

interface Upstream {
  url: string;
  requested: string[];
}

/** Serves only the health path, exactly as an allowlisted control plane does. */
async function startUpstream(): Promise<Upstream> {
  const requested: string[] = [];
  const app = express();
  app.use((req, res, next) => {
    requested.push(req.path);
    if (req.path === UPSTREAM_HEALTH_PATH) return next();
    // What the proxy's source-IP gate answers to a non-operator address.
    return res.status(403).json({ error: "Forbidden." });
  });
  app.get(UPSTREAM_HEALTH_PATH, (_req, res) => res.json({ status: "ok" }));

  return await new Promise((resolve) => {
    upstream = app.listen(0, "127.0.0.1", () => {
      const { port } = upstream!.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, requested });
    });
  });
}

async function readyz(baseUrl: string): Promise<{ status: number; body: unknown }> {
  const { createHttpApp } = await import("../src/transport.js");
  const app = createHttpApp({
    apiBaseUrl: baseUrl,
    apiToken: "test-token",
    workspaceId: "ws-test",
    agentId: "agent-test",
    transport: "http",
    httpPort: 0,
    httpPath: "/mcp",
    requireBearerAuth: true,
    httpRateLimitPerSecond: 25,
    httpRateLimitBurst: 50,
  });

  const server = app.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/readyz`);
  const body = await response.json();
  await new Promise((resolve) => server.close(resolve));
  return { status: response.status, body };
}

afterEach(async () => {
  if (upstream) await new Promise((resolve) => upstream!.close(resolve));
  upstream = undefined;
});

describe("readiness probe", () => {
  it("asks the control plane for its health path", async () => {
    const { url, requested } = await startUpstream();

    const { status } = await readyz(url);

    expect(requested).toContain(UPSTREAM_HEALTH_PATH);
    // The root is what the allowlist refuses; asking for it is the defect.
    expect(requested).not.toContain("/");
    expect(status).toBe(200);
  });

  it("reports ready against an upstream that allowlists everything else", async () => {
    // The upstream here answers 403 to every path but health, which is exactly
    // the deployed arrangement. Before the fix this returned 503.
    const { url } = await startUpstream();

    const { status, body } = await readyz(url);

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
  });

  it("still reports not-ready when the control plane is genuinely down", async () => {
    // Guard against fixing the false negative by making the check unfalsifiable.
    const { status, body } = await readyz("http://127.0.0.1:9");

    expect(status).toBe(503);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("tolerates a base URL with a trailing slash", async () => {
    const { url, requested } = await startUpstream();

    await readyz(`${url}/`);

    expect(requested).toContain(UPSTREAM_HEALTH_PATH);
    expect(requested.some((path) => path.startsWith("//"))).toBe(false);
  });
});
