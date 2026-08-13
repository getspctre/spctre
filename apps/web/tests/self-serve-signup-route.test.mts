import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SelfServeSignupOutcome,
  SelfServeSignupSlot,
} from "@/lib/ee-adapters/self-serve-signup";
import { createRouteRequest } from "./route-test-helper";

let slot: SelfServeSignupSlot;
const startSpy = vi.fn<(request: unknown) => Promise<SelfServeSignupOutcome>>();

vi.mock("@/lib/ee-adapters/self-serve-signup", () => ({
  loadSelfServeSignupSlot: async () => slot,
}));

const { POST } = await import("@/app/api/onboarding/self-serve/route");

const PATH = "/api/onboarding/self-serve";

function post(body: unknown, headers?: HeadersInit): Request {
  return createRouteRequest({ path: PATH, body, headers });
}

const validBody = { email: "New.Operator@Example.test", displayName: "New Operator" };

beforeEach(() => {
  startSpy.mockReset();
  startSpy.mockResolvedValue({ status: "accepted" });
  slot = { available: () => true, start: startSpy };
});

describe("POST /api/onboarding/self-serve", () => {
  it("answers 404 when no commercial implementation is installed", async () => {
    slot = {
      available: () => false,
      start: async () => ({ status: "unavailable" }) as SelfServeSignupOutcome,
    };

    const response = await POST(post(validBody), { params: Promise.resolve({}) });

    expect(response.status).toBe(404);
    // The slot is never consulted for a deployment that does not offer signup.
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("normalizes the address and forwards the request to the slot", async () => {
    const response = await POST(post(validBody), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(startSpy).toHaveBeenCalledWith({
      email: "new.operator@example.test",
      displayName: "New Operator",
      returnTo: null,
      clientIp: null,
    });
  });

  it("passes the leftmost forwarded hop as the caller origin", async () => {
    await POST(post(validBody, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), {
      params: Promise.resolve({}),
    });

    expect(startSpy.mock.calls[0][0]).toMatchObject({ clientIp: "203.0.113.7" });
  });

  it("keeps a same-origin return path", async () => {
    await POST(post({ ...validBody, returnTo: "/onboarding/cli/approve?code=abc123" }), {
      params: Promise.resolve({}),
    });

    expect(startSpy.mock.calls[0][0]).toMatchObject({
      returnTo: "/onboarding/cli/approve?code=abc123",
    });
  });

  // An absolute or protocol-relative destination would leave the product as an
  // open redirect carried by a link the operator was told to trust.
  it.each([
    ["absolute", "https://evil.example/steal"],
    ["protocol-relative", "//evil.example/steal"],
    ["backslash-escaped", "/\\evil.example/steal"],
    ["scheme-only", "javascript:alert(1)"],
    ["relative", "onboarding/cli/approve"],
  ])("drops a %s return path", async (_label, returnTo) => {
    await POST(post({ ...validBody, returnTo }), { params: Promise.resolve({}) });

    expect(startSpy.mock.calls[0][0]).toMatchObject({ returnTo: null });
  });

  it("reports rate limiting with a Retry-After header", async () => {
    startSpy.mockResolvedValue({ status: "rate_limited", retryAfterSeconds: 900 });

    const response = await POST(post(validBody), { params: Promise.resolve({}) });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
  });

  /**
   * Hand-built rather than via createRouteRequest: the helper JSON-encodes
   * whatever body it is given, so asking it for invalid JSON yields a valid
   * JSON string instead. Only a raw body reaches the parse failure this covers.
   */
  it("rejects a malformed body before reaching the slot", async () => {
    const malformed = new Request(new URL(PATH, "http://localhost:3000"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const response = await POST(malformed, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("answers identically whether or not the address already has an account", async () => {
    const first = await POST(post(validBody), { params: Promise.resolve({}) });
    const firstBody = await first.json();

    // A commercial implementation returns "accepted" for a known address too;
    // this asserts the route adds no distinguishing detail of its own.
    startSpy.mockResolvedValue({ status: "accepted" });
    const second = await POST(post(validBody), { params: Promise.resolve({}) });
    const secondBody = await second.json();

    expect(first.status).toBe(second.status);
    expect(Object.keys(firstBody).sort()).toEqual(Object.keys(secondBody).sort());
    expect(firstBody.ok).toBe(true);
    expect(JSON.stringify(firstBody)).not.toMatch(/exists|already|unknown|created/i);
  });
});
