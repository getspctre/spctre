import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestPublishedPolicyBundleSpy = vi.fn();
const retainPublishedPolicyContentArtifactSpy = vi.fn();
const resolveRouteScopeSpy = vi.fn();

vi.mock("@/lib/domains/policy/service", () => ({
  getLatestPublishedPolicyBundle: getLatestPublishedPolicyBundleSpy,
}));
vi.mock("@/lib/repositories/policy-content-artifacts", () => ({
  retainPublishedPolicyContentArtifact: retainPublishedPolicyContentArtifactSpy,
}));
vi.mock("@/lib/platform/api-route", () => ({}));
vi.mock("../app/api/_route-scope", () => ({ resolveRouteScope: resolveRouteScopeSpy }));

const route = await import("../app/api/bundle/latest/custody/route");

const bundle = { revisionId: "revision-1", rules: [], generatedAt: "2026-08-06T00:00:00.000Z" };

describe("published bundle custody route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRouteScopeSpy.mockResolvedValue({ tenantId: "tenant-1", workspaceId: "workspace-1", actorId: "actor-1" });
    getLatestPublishedPolicyBundleSpy.mockResolvedValue({
      publishId: "publish-1",
      revisionId: "revision-1",
      contentHash: `sha256:${"a".repeat(64)}`,
      bundle,
    });
    retainPublishedPolicyContentArtifactSpy.mockResolvedValue(undefined);
  });

  it("retains the exact serialized bundle under its immutable publication", async () => {
    const response = await route.POST(new Request("http://localhost:3000/api/bundle/latest/custody", { method: "POST" }));

    expect(response.status).toBe(201);
    expect(retainPublishedPolicyContentArtifactSpy).toHaveBeenCalledWith({
      contentHash: `sha256:${"a".repeat(64)}`,
      bytes: new TextEncoder().encode(JSON.stringify(bundle, null, 2)),
      mediaType: "application/json",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      publishId: "publish-1",
      revisionId: "revision-1",
    });
    await expect(response.json()).resolves.toMatchObject({ retained: true, publishId: "publish-1" });
  });

  it("does not retain when no publication exists", async () => {
    getLatestPublishedPolicyBundleSpy.mockResolvedValue(null);
    const response = await route.POST(new Request("http://localhost:3000/api/bundle/latest/custody", { method: "POST" }));
    expect(response.status).toBe(404);
    expect(retainPublishedPolicyContentArtifactSpy).not.toHaveBeenCalled();
  });
});
