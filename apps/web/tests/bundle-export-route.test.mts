import { describe, expect, it, beforeEach, vi } from "vitest";

const getAuthSessionSpy = vi.fn();
const getActiveScopeSpy = vi.fn();
const getLatestPublishedPolicyBundleSpy = vi.fn();
const appendOperationsLogSpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeSpy }));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi.fn(),
  hasBearerToken: vi.fn(() => false),
}));

vi.mock("@/lib/domains/policy/service", () => ({
  getLatestPublishedPolicyBundle: getLatestPublishedPolicyBundleSpy,
}));

vi.mock("@/lib/feature-flags-server", () => ({ getSpctrePlan: () => "OSS" }));

vi.mock("@/lib/repositories/operations-log/log", () => ({
  appendOperationsLog: appendOperationsLogSpy,
}));

const route = await import("../app/api/bundle/latest/route");

describe("bundle latest export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthSessionSpy.mockResolvedValue({ principalId: "user-1" });
    getActiveScopeSpy.mockResolvedValue({ workspaceId: "workspace-1", tenantId: "tenant-1" });
    getLatestPublishedPolicyBundleSpy.mockResolvedValue(publishedBundle());
    appendOperationsLogSpy.mockResolvedValue(undefined);
  });

  it("preserves legacy raw bundle download when no format is requested", async () => {
    const response = await route.GET(new Request("http://localhost:3000/api/bundle/latest"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-spctre-artifact-hash")).toBe("sha256:artifact");
    const body = await response.json();
    expect(body).toMatchObject({
      branchId: "branch-1",
      revisionId: "revision-1",
      artifactHash: "sha256:artifact",
    });
    expect(body.manifest).toBeUndefined();
  });

  it("returns an export envelope for supported target formats", async () => {
    const response = await route.GET(
      new Request("http://localhost:3000/api/bundle/latest?format=opa-bundle"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-spctre-export-format")).toBe("opa-bundle");
    expect(response.headers.get("x-spctre-export-ok")).toBe("true");
    expect(response.headers.get("x-spctre-export-verified")).toBe("true");
    const body = await response.json();
    expect(body.manifest).toMatchObject({
      format: "opa-bundle",
      artifactHash: "sha256:artifact",
      provenance: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        branchId: "branch-1",
        revisionId: "revision-1",
      },
    });
    expect(body.artifact["policy.rego"]).toContain("package spctre.policy");
    expect(body.artifact["data.json"].spctre.provenance.artifact_hash).toBe("sha256:artifact");
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        eventType: "BUNDLE_EXPORT",
        actorId: "user-1",
        payload: expect.objectContaining({
          format: "opa-bundle",
          outcome: "EXPORTED",
          verified: true,
          artifactHash: "sha256:artifact",
        }),
      }),
    );
  });

  it("returns preview manifests for all supported target formats", async () => {
    const response = await route.GET(
      new Request("http://localhost:3000/api/bundle/latest?preview=true"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact).toBeUndefined();
    expect(body.formats.map((manifest: { format: string }) => manifest.format)).toEqual([
      "spctre-json",
      "opa-rego",
      "opa-bundle",
      "cedar",
      "mcp-proxy-config",
    ]);
    expect(
      body.formats.every(
        (manifest: { artifactHash: string }) => manifest.artifactHash === "sha256:artifact",
      ),
    ).toBe(true);
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "BUNDLE_EXPORT",
        payload: expect.objectContaining({ format: "preview", outcome: "PREVIEW" }),
      }),
    );
  });

  it("returns 400 for unsupported formats", async () => {
    const response = await route.GET(
      new Request("http://localhost:3000/api/bundle/latest?format=wasm"),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.supportedFormats).toContain("opa-bundle");
  });

  it("returns 409 with manifest when export is blocked", async () => {
    getLatestPublishedPolicyBundleSpy.mockResolvedValue(
      publishedBundle({
        rules: [
          {
            stableRuleId: "github.repo.escalate_write",
            title: "Escalate repository writes",
            effect: "ESCALATE",
            sourceFormat: "SPCTRE_MANAGED",
            domains: ["source-control"],
            connectors: ["github"],
            actions: ["repo.write"],
            immutable: false,
          },
        ],
      }),
    );

    const response = await route.GET(
      new Request("http://localhost:3000/api/bundle/latest?format=cedar"),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-spctre-export-ok")).toBe("false");
    expect(response.headers.get("x-spctre-export-verified")).toBe("false");
    const body = await response.json();
    expect(body.artifact).toBeUndefined();
    expect(body.manifest.blockingWarnings).toContain(
      "Cedar cannot enforce ESCALATE semantics for rule github.repo.escalate_write.",
    );
    expect(appendOperationsLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "BUNDLE_EXPORT",
        payload: expect.objectContaining({
          format: "cedar",
          outcome: "BLOCKED",
          verified: false,
          blockingWarnings: [
            "Cedar cannot enforce ESCALATE semantics for rule github.repo.escalate_write.",
          ],
        }),
      }),
    );
  });
});

function publishedBundle(overrides: Record<string, unknown> = {}) {
  const bundle = {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    branchId: "branch-1",
    revisionId: "revision-1",
    sourceFormat: "SPCTRE_MANAGED",
    sourcePath: "policies/github.yaml",
    sourceHash: "sha256:source",
    artifactHash: "sha256:artifact",
    targetStacks: [{ stack: "LOCAL", adapter: "spctre-test", environment: "test" }],
    approvals: [],
    rules: [
      {
        stableRuleId: "github.repo.block_delete",
        title: "Block repository deletion",
        effect: "DENY",
        sourceFormat: "SPCTRE_MANAGED",
        domains: ["source-control"],
        connectors: ["github"],
        actions: ["repo.delete"],
        immutable: false,
      },
    ],
    generatedAt: "2026-07-05T00:00:00.000Z",
    metadata: {},
    ...overrides,
  };
  return {
    publishId: "publish-1",
    publishedAt: "2026-07-05T00:00:00.000Z",
    publishedBy: "user-1",
    branchId: "branch-1",
    revisionId: "revision-1",
    artifactHash: "sha256:artifact",
    bundle,
  };
}
