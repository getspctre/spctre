import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieSetSpy = vi.fn();
const cookiesSpy = vi.fn(async () => ({ set: cookieSetSpy }));
const ensureDemoTenantSpy = vi.fn(async () => undefined);
const sqlSpy = vi.fn();

vi.mock("next/headers", () => ({ cookies: cookiesSpy }));

vi.mock("@/lib/workspace/cookies", () => ({
  ACTIVE_TENANT_COOKIE: "spctre_tenant_id",
  ACTIVE_WORKSPACE_COOKIE: "spctre_workspace_id",
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: vi.fn(async () => ({
    tenantId: "tenant-demo",
    principalId: "principal-demo",
    subject: "dev@example.com",
  })),
}));

vi.mock("@/lib/db", () => ({ sql: sqlSpy }));

vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "tenant-demo",
  DEMO_WORKSPACE_ID: "workspace-demo",
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({ ensureDemoTenant: ensureDemoTenantSpy }));

const { POST } = await import("../app/api/workspace/normalize/route");

describe("POST /api/workspace/normalize", () => {
  beforeEach(() => {
    cookieSetSpy.mockClear();
    cookiesSpy.mockClear();
    ensureDemoTenantSpy.mockClear();
    sqlSpy.mockReset();
  });

  it("sets the requested workspace cookie when the workspace exists", async () => {
    sqlSpy.mockImplementation(async (strings, ...values) => {
      const query = strings.join(" ");

      if (query.includes("WHERE tenant_id") && query.includes("AND id")) {
        return values[1] === "workspace-2" ? [{ id: "workspace-2" }] : [];
      }

      if (query.includes("ORDER BY created_at ASC")) {
        return [{ id: "workspace-1" }];
      }

      return [];
    });

    const request = new Request("http://localhost/api/workspace/normalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "workspace-2" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(cookieSetSpy).toHaveBeenCalledWith("spctre_tenant_id", "tenant-demo", {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: false,
    });
    expect(cookieSetSpy).toHaveBeenCalledWith("spctre_workspace_id", "workspace-2", {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: false,
    });
  });

  it("falls back to the first available workspace when the request is stale", async () => {
    sqlSpy.mockImplementation(async (strings) => {
      const query = strings.join(" ");

      if (query.includes("WHERE tenant_id") && query.includes("AND id")) {
        return [];
      }

      if (query.includes("ORDER BY created_at ASC")) {
        return [{ id: "workspace-1" }];
      }

      return [];
    });

    const request = new Request("http://localhost/api/workspace/normalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "missing-workspace" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(cookieSetSpy).toHaveBeenCalledWith("spctre_tenant_id", "tenant-demo", {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: false,
    });
    expect(cookieSetSpy).toHaveBeenCalledWith("spctre_workspace_id", "workspace-1", {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: false,
    });
  });
});
