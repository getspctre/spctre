import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { getClientIp, UNATTRIBUTABLE_CLIENT_IP } from "../src/util.js";

function makeRequest(headers: Record<string, string>, ip = "10.0.0.1"): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe("client IP derivation", () => {
  afterEach(() => {
    delete process.env.SPCTRE_TRUSTED_PROXY_HOPS;
  });

  // The source-IP allowlist and the rate-limit key both derive from this, and
  // x-forwarded-for is caller-supplied until a proxy we control appends to it.
  it("takes the client address from the declared trusted hop", () => {
    process.env.SPCTRE_TRUSTED_PROXY_HOPS = "1";

    const ip = getClientIp(makeRequest({ "x-forwarded-for": "203.0.113.10, 198.51.100.7" }));

    expect(ip).toBe("198.51.100.7");
  });

  it("ignores entries prepended by the caller", () => {
    process.env.SPCTRE_TRUSTED_PROXY_HOPS = "1";

    const ip = getClientIp(makeRequest({ "x-forwarded-for": "198.51.100.7, 203.0.113.10" }));

    expect(ip).toBe("203.0.113.10");
  });

  // Reaching the server without traversing the declared chain is the case the
  // hop count exists for; answering with req.ip or the socket address would
  // hand back the proxy's own address instead.
  it("attributes nothing when the chain was not traversed", () => {
    process.env.SPCTRE_TRUSTED_PROXY_HOPS = "2";

    expect(getClientIp(makeRequest({ "x-forwarded-for": "198.51.100.7" }))).toBe(
      UNATTRIBUTABLE_CLIENT_IP,
    );
    expect(getClientIp(makeRequest({}))).toBe(UNATTRIBUTABLE_CLIENT_IP);
  });

  it("keeps the leftmost entry when no hop count is declared", () => {
    const ip = getClientIp(makeRequest({ "x-forwarded-for": "198.51.100.7, 203.0.113.10" }));

    expect(ip).toBe("198.51.100.7");
  });

  it("falls back to the socket address when no header is present", () => {
    expect(getClientIp(makeRequest({}, "10.0.0.9"))).toBe("10.0.0.9");
  });
});
