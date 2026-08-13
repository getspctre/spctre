import { beforeEach, describe, expect, it, vi } from "vitest";

const getSpctrePlanSpy = vi.fn<() => string>();
const loadCommercialSlotSpy = vi.fn<(slotPath: string) => Promise<unknown>>();

vi.mock("@/lib/feature-flags-server", () => ({ getSpctrePlan: getSpctrePlanSpy }));
vi.mock("@/lib/ee-adapters/slot-loader", () => ({ loadCommercialSlot: loadCommercialSlotSpy }));

const { loadSamlSlot, samlAuthorizeGET, samlCallbackPOST, samlMetadataGET } =
  await import("@/lib/ee-adapters/saml");

const request = new Request("https://app.example.test/api/auth/saml/authorize");

beforeEach(() => {
  getSpctrePlanSpy.mockReset().mockReturnValue("enterprise");
  loadCommercialSlotSpy.mockReset();
});

describe("SAML slot", () => {
  it("answers 404 on an OSS deployment without attempting the import", async () => {
    getSpctrePlanSpy.mockReturnValue("oss");

    const response = await samlAuthorizeGET(request);

    expect(response.status).toBe(404);
    expect(loadCommercialSlotSpy).not.toHaveBeenCalled();
  });

  it("delegates every endpoint to the commercial implementation", async () => {
    const samlService = {
      authorizeGET: vi.fn(async () => new Response("authorize", { status: 302 })),
      callbackPOST: vi.fn(async () => new Response("callback", { status: 303 })),
      metadataGET: vi.fn(async () => new Response("<xml/>", { status: 200 })),
    };
    loadCommercialSlotSpy.mockResolvedValue({ samlService });

    expect((await samlAuthorizeGET(request)).status).toBe(302);
    expect((await samlCallbackPOST(request)).status).toBe(303);
    expect((await samlMetadataGET()).status).toBe(200);

    expect(loadCommercialSlotSpy).toHaveBeenCalledWith("web/saml/index.js");
    expect(samlService.authorizeGET).toHaveBeenCalledWith(request);
  });

  /**
   * The failure this replaces was silent: the build was supposed to substitute
   * this module and never did, so the 404s shipped looking like configuration.
   * Refusing loudly is the point — an assertion a deployment cannot validate
   * must not become a session.
   */
  it("fails closed when the implementation cannot be loaded", async () => {
    loadCommercialSlotSpy.mockRejectedValue(new Error("module not found"));

    const slot = await loadSamlSlot();

    expect((await slot.callbackPOST(request)).status).toBe(404);
  });
});
