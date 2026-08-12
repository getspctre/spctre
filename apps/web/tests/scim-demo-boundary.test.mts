import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const getSpctrePlanSpy = vi.fn();
const handleRequestSpy = vi.fn();
const resolveScimTokenBindingSpy = vi.fn();

vi.mock("@/lib/feature-flags-server", () => ({ getSpctrePlan: getSpctrePlanSpy }));

vi.mock("@/lib/ee-adapters/scim", () => ({ scimService: { handleRequest: handleRequestSpy } }));

vi.mock("@/lib/domains/scim-token/service", () => ({
  resolveScimTokenBinding: resolveScimTokenBindingSpy,
}));

const scimRoute = await import("../app/api/scim/v2/[...scimPath]/route");

function scimUsersRequest(headers?: HeadersInit) {
  return createRouteRequest({ path: "/api/scim/v2/Users", method: "GET", headers });
}

function scimParams() {
  return { params: Promise.resolve({ scimPath: ["Users"] }) };
}

describe("SCIM OSS boundary (auth, tenant binding, and entitlement before the ee slot)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    getSpctrePlanSpy.mockReset();
    handleRequestSpy.mockReset();
    resolveScimTokenBindingSpy.mockReset();
    getSpctrePlanSpy.mockReturnValue("enterprise");
    handleRequestSpy.mockResolvedValue(Response.json({ totalResults: 0, Resources: [] }));
    resolveScimTokenBindingSpy.mockResolvedValue({ ok: false, reason: "unknown_token" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses OSS-plan deployments outright", async () => {
    getSpctrePlanSpy.mockReturnValue("oss");

    const response = await scimRoute.GET(scimUsersRequest(), scimParams());

    expect(response.status).toBe(403);
    expect(handleRequestSpy).not.toHaveBeenCalled();
    expect(resolveScimTokenBindingSpy).not.toHaveBeenCalled();
  });

  it("fails closed when no credentials are presented", async () => {
    const response = await scimRoute.GET(scimUsersRequest(), scimParams());

    expect(response.status).toBe(401);
    expect(handleRequestSpy).not.toHaveBeenCalled();
  });

  it("rejects a bearer token that matches neither the env secret nor a DB registration", async () => {
    vi.stubEnv("SCIM_BEARER_TOKEN", "secret");

    const response = await scimRoute.GET(
      scimUsersRequest({ authorization: "Bearer wrong" }),
      scimParams(),
    );

    expect(response.status).toBe(401);
    expect(resolveScimTokenBindingSpy).toHaveBeenCalledWith("wrong");
    expect(handleRequestSpy).not.toHaveBeenCalled();
  });

  it("delegates env-token requests on enterprise deployments with an env binding", async () => {
    vi.stubEnv("SCIM_BEARER_TOKEN", "secret");

    const request = scimUsersRequest({ authorization: "Bearer secret" });
    const response = await scimRoute.GET(request, scimParams());

    expect(response.status).toBe(200);
    expect(handleRequestSpy).toHaveBeenCalledWith(request, ["Users"], { mode: "env" });
    expect(resolveScimTokenBindingSpy).not.toHaveBeenCalled();
  });

  it("refuses the env token on hosted (cloud) deployments", async () => {
    vi.stubEnv("SCIM_BEARER_TOKEN", "secret");
    getSpctrePlanSpy.mockReturnValue("cloud");

    const response = await scimRoute.GET(
      scimUsersRequest({ authorization: "Bearer secret" }),
      scimParams(),
    );

    expect(response.status).toBe(403);
    expect(handleRequestSpy).not.toHaveBeenCalled();
  });

  it("delegates DB-bound tokens with the pre-resolved tenant binding", async () => {
    getSpctrePlanSpy.mockReturnValue("cloud");
    resolveScimTokenBindingSpy.mockResolvedValue({
      ok: true,
      tenantId: "tenant-ent",
      registrationId: "reg-1",
    });

    const request = scimUsersRequest({ authorization: "Bearer scim_abc" });
    const response = await scimRoute.GET(request, scimParams());

    expect(response.status).toBe(200);
    expect(resolveScimTokenBindingSpy).toHaveBeenCalledWith("scim_abc");
    expect(handleRequestSpy).toHaveBeenCalledWith(request, ["Users"], {
      mode: "token",
      tenantId: "tenant-ent",
    });
  });

  it("refuses valid tokens whose tenant is no longer entitled", async () => {
    getSpctrePlanSpy.mockReturnValue("cloud");
    resolveScimTokenBindingSpy.mockResolvedValue({ ok: false, reason: "not_entitled" });

    const response = await scimRoute.GET(
      scimUsersRequest({ authorization: "Bearer scim_abc" }),
      scimParams(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "SCIM 2.0 Directory Sync requires an Enterprise subscription.",
    });
    expect(handleRequestSpy).not.toHaveBeenCalled();
  });

  it("allows unauthenticated SCIM only behind the explicit non-production opt-in", async () => {
    vi.stubEnv("SCIM_ALLOW_UNAUTHENTICATED_DEV", "true");

    const response = await scimRoute.GET(scimUsersRequest(), scimParams());

    expect(response.status).toBe(200);
    expect(handleRequestSpy).toHaveBeenCalledWith(expect.any(Request), ["Users"], { mode: "env" });
  });

  it("ignores the dev bypass when an env secret is configured", async () => {
    vi.stubEnv("SCIM_ALLOW_UNAUTHENTICATED_DEV", "true");
    vi.stubEnv("SCIM_BEARER_TOKEN", "secret");

    const response = await scimRoute.GET(scimUsersRequest(), scimParams());

    expect(response.status).toBe(401);
    expect(handleRequestSpy).not.toHaveBeenCalled();
  });
});
