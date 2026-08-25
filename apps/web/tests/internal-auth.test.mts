import { describe, expect, it } from "vitest";
import { bearerSecretMatches, secretMatches } from "@/lib/platform/internal-auth";

describe("internal bearer secret comparison", () => {
  it("accepts the exact secret", () => {
    expect(bearerSecretMatches("Bearer worker-secret", "worker-secret")).toBe(true);
  });

  it("rejects a wrong, missing, or malformed credential", () => {
    expect(bearerSecretMatches("Bearer wrong-secret", "worker-secret")).toBe(false);
    expect(bearerSecretMatches("Bearer ", "worker-secret")).toBe(false);
    expect(bearerSecretMatches("worker-secret", "worker-secret")).toBe(false);
    expect(bearerSecretMatches(null, "worker-secret")).toBe(false);
    expect(bearerSecretMatches(undefined, "worker-secret")).toBe(false);
  });

  it("rejects a prefix or an extension of the secret rather than throwing", () => {
    // timingSafeEqual throws on unequal lengths; the length check has to come
    // first or these become 500s instead of 401s.
    expect(secretMatches("worker-secre", "worker-secret")).toBe(false);
    expect(secretMatches("worker-secret-extra", "worker-secret")).toBe(false);
  });

  it("compares multibyte secrets by bytes, not by code units", () => {
    expect(secretMatches("sécret", "sécret")).toBe(true);
    expect(secretMatches("sécret", "sxcret")).toBe(false);
  });
});
