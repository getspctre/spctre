import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/repositories/seed/local-dev", () => ({ ensureDemoTenant: vi.fn() }));

const { revokeAuthSession } = await import("../lib/auth-session");

describe("session cookie repository input contract", () => {
  it("rejects revocation without a tenant ID", async () => {
    await expect(revokeAuthSession("session-1", undefined as unknown as string)).rejects.toThrow(
      "Tenant ID is required.",
    );
    await expect(revokeAuthSession("session-1", "   ")).rejects.toThrow("Tenant ID is required.");
  });

  it("rejects revocation without a session ID", async () => {
    await expect(revokeAuthSession(undefined as unknown as string, "tenant-1")).rejects.toThrow(
      "Session ID is required.",
    );
    await expect(revokeAuthSession("   ", "tenant-1")).rejects.toThrow("Session ID is required.");
  });
});
