import { describe, expect, it } from "vitest";
import { DEMO_TENANT_ID } from "../lib/demo";
import { canUseDemoFallbackData, isDemoTenant } from "../lib/demo-guard";

describe("demo tenant guard", () => {
  it("classifies the demo tenant by id alone", () => {
    expect(isDemoTenant(DEMO_TENANT_ID)).toBe(true);
    expect(isDemoTenant("00000000-0000-0000-0000-00000000eeee")).toBe(false);
  });

  it("allows sample fallback data only for the demo tenant", () => {
    expect(canUseDemoFallbackData(DEMO_TENANT_ID)).toBe(true);
    expect(canUseDemoFallbackData("tenant-production")).toBe(false);
  });
});
