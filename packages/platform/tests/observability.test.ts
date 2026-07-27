import { describe, expect, it, vi } from "vitest";
import { logger, redactAttributes, withSpan } from "../src/observability.js";

describe("observability helpers", () => {
  it("redacts sensitive attributes before telemetry/logging", () => {
    expect(redactAttributes({
      token: "secret-token",
      refreshToken: "secret-refresh",
      workspace: "workspace-demo",
      headers: {
        authorization: "Bearer secret",
      },
      count: 3,
    })).toEqual({
      token: "[REDACTED]",
      refreshToken: "[REDACTED]",
      workspace: "workspace-demo",
      headers: "{\"authorization\":\"[REDACTED]\"}",
      count: 3,
    });
  });

  it("redacts PII keys without over-matching benign attribute names", () => {
    expect(redactAttributes({
      cardNumber: "4111",
      credit_card: "4111",
      card: "4111",
      user_ssn: "123-45-6789",
      userSsn: "123-45-6789",
      customerSSN: "123-45-6789",
      ssnLast4: "6789",
      // camelCase card compounds: `card` must match as a word, not a substring.
      cardCvc: "123",
      cardExpiry: "12/28",
      cardLast4: "4242",
      card_expiry: "12/28",
      email: "a@b.c",
      // Benign keys that contain the sensitive substrings must pass through.
      cardinality: 42,
      discarded: 7,
      className: "btn-primary",
      processNode: "node-1",
    })).toEqual({
      cardNumber: "[REDACTED]",
      credit_card: "[REDACTED]",
      card: "[REDACTED]",
      user_ssn: "[REDACTED]",
      userSsn: "[REDACTED]",
      customerSSN: "[REDACTED]",
      ssnLast4: "[REDACTED]",
      cardCvc: "[REDACTED]",
      cardExpiry: "[REDACTED]",
      cardLast4: "[REDACTED]",
      card_expiry: "[REDACTED]",
      email: "[REDACTED]",
      cardinality: 42,
      discarded: 7,
      className: "btn-primary",
      processNode: "node-1",
    });
  });

  it("runs work inside a span wrapper and returns the result", async () => {
    await expect(withSpan("test.span", { route: "/test" }, async () => "ok")).resolves.toBe("ok");
  });

  it("returns HTTP error responses without throwing from the span wrapper", async () => {
    const response = await withSpan("test.http", { route: "/missing" }, async () => Response.json({ error: "nope" }, { status: 404 }));
    expect(response.status).toBe(404);
  });

  it("emits structured JSON logs to stderr with nested redacted attributes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logger.error("hello", {
        accessToken: "secret",
        route: "/test",
        payload: { refreshToken: "nested-secret" },
      });
      const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
      expect(payload.message).toBe("hello");
      expect(payload.accessToken).toBe("[REDACTED]");
      expect(payload.route).toBe("/test");
      expect(payload.payload).toContain("[REDACTED]");
    } finally {
      spy.mockRestore();
    }
  });
});
