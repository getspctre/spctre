import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_VERSION } from "@spctre/api-contracts";

const getAuthSessionSpy = vi.fn();
const getWorkspaceContextSpy = vi.fn();
const listOperationsLogSpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/workspace/scope", () => ({ getActiveScope: getWorkspaceContextSpy }));

vi.mock("@/lib/repositories/operations-log", () => ({ listOperationsLog: listOperationsLogSpy }));

vi.mock("@/lib/db", () => ({
  runWithTenantContext: vi.fn((_tenantId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: vi.fn((_tenantId: string, fn: () => Promise<unknown>) => fn()),
}));

const route = await import("../app/api/operations/route");

describe("operations route response shape", () => {
  beforeEach(() => {
    getAuthSessionSpy.mockReset();
    getWorkspaceContextSpy.mockReset();
    listOperationsLogSpy.mockReset();
  });

  it("returns pagination and additive meta for read-side responses", async () => {
    getAuthSessionSpy.mockResolvedValue({ principalId: "principal-1", tenantId: "tenant-1" });
    getWorkspaceContextSpy.mockResolvedValue({ workspaceId: "workspace-1", tenantId: "tenant-1" });
    listOperationsLogSpy.mockResolvedValue([
      {
        id: "op-1",
        eventType: "POLICY_PUBLISH",
        sourceId: "source-1",
        sourceTable: "policy_publish",
        actorId: "principal-1",
        payload: { ok: true },
        createdAt: "2026-05-08T00:00:00.000Z",
      },
    ]);

    const response = await route.GET(
      new Request("http://localhost:3000/api/operations?limit=25&offset=5", {
        headers: { "x-request-id": "trace-operations" },
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("trace-operations");
    expect(listOperationsLogSpy).toHaveBeenCalledWith("tenant-1", "workspace-1", {
      eventType: undefined,
      limit: 25,
      offset: 5,
    });
    expect(body.count).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(5);
    expect(body.pagination).toEqual({ total: 1, limit: 25, offset: 5 });
    expect(body.meta).toMatchObject({ traceId: "trace-operations", version: API_VERSION });
  });
});
