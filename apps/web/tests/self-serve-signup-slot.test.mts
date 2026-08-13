import { beforeEach, describe, expect, it, vi } from "vitest";

const getSpctrePlanSpy = vi.fn<() => string>();
const loadCommercialSlotSpy = vi.fn<(slotPath: string) => Promise<unknown>>();

vi.mock("@/lib/feature-flags-server", () => ({ getSpctrePlan: getSpctrePlanSpy }));
vi.mock("@/lib/ee-adapters/slot-loader", () => ({ loadCommercialSlot: loadCommercialSlotSpy }));

const { loadSelfServeSignupSlot } = await import("@/lib/ee-adapters/self-serve-signup");

beforeEach(() => {
  getSpctrePlanSpy.mockReset().mockReturnValue("cloud");
  loadCommercialSlotSpy.mockReset();
});

describe("self-serve signup slot", () => {
  it("does not offer signup on an OSS deployment", async () => {
    getSpctrePlanSpy.mockReturnValue("oss");

    const slot = await loadSelfServeSignupSlot();

    expect(slot.available()).toBe(false);
    // An OSS deployment must not even attempt the dynamic import: there is no
    // ee/ directory in that build.
    expect(loadCommercialSlotSpy).not.toHaveBeenCalled();
    expect(
      await slot.start({ email: "a@b.test", displayName: "A", returnTo: null, clientIp: null }),
    ).toEqual({ status: "unavailable" });
  });

  it("resolves the commercial implementation on a hosted deployment", async () => {
    const commercial = { available: () => true, start: async () => ({ status: "accepted" }) };
    loadCommercialSlotSpy.mockResolvedValue({ selfServeSignupService: commercial });

    const slot = await loadSelfServeSignupSlot();

    expect(loadCommercialSlotSpy).toHaveBeenCalledWith("web/self-serve-signup/index.js");
    expect(slot.available()).toBe(true);
  });

  it("fails closed when the commercial slot cannot be loaded", async () => {
    loadCommercialSlotSpy.mockRejectedValue(new Error("module not found"));

    const slot = await loadSelfServeSignupSlot();

    // Withholding signup is the only safe degradation: creating an account
    // here would be creating one on terms no commercial implementation chose.
    expect(slot.available()).toBe(false);
    expect(
      await slot.start({ email: "a@b.test", displayName: "A", returnTo: null, clientIp: null }),
    ).toEqual({ status: "unavailable" });
  });
});
