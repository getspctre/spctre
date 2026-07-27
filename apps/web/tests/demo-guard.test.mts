import { describe, expect, it, vi } from "vitest";
import { DEMO_TENANT_ID } from "../lib/demo";
import { canUseDemoFallbackData, isDemoTenant } from "../lib/demo-guard";

describe("demo tenant guard", () => {
  it("does not let E2E API enablement change demo tenant classification", () => {
    vi.stubEnv("SPCTRE_E2E_API_ENABLED", "true");

    expect(isDemoTenant(DEMO_TENANT_ID)).toBe(true);
    expect(isDemoTenant("00000000-0000-0000-0000-00000000eeee")).toBe(false);

    vi.unstubAllEnvs();
  });

  it("allows sample fallback data only for the demo tenant", () => {
    expect(canUseDemoFallbackData(DEMO_TENANT_ID)).toBe(true);
    expect(canUseDemoFallbackData("tenant-production")).toBe(false);
  });
});
