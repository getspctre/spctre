import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const authenticateServiceTokenSpy = vi.fn();
const retainPolicyContentArtifactSpy = vi.fn();
const readPolicyContentArtifactSpy = vi.fn();
const runWithTenantContextSpy = vi.fn(async (_tenantId: string, operation: () => unknown) => operation());

vi.mock("@/lib/service-tokens", () => ({ authenticateServiceToken: authenticateServiceTokenSpy }));
vi.mock("@/lib/tenant-context", () => ({ runWithTenantContext: runWithTenantContextSpy }));
vi.mock("@/lib/repositories/policy-content-artifacts", () => ({
  MAX_POLICY_CONTENT_ARTIFACT_BYTES: 10 * 1024 * 1024,
  policyContentHash: (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  retainPolicyContentArtifact: retainPolicyContentArtifactSpy,
  readPolicyContentArtifactForEvidenceToken: readPolicyContentArtifactSpy,
}));

const postRoute = await import("../app/api/evidence/policy-artifacts/route");
const getRoute = await import("../app/api/evidence/policy-artifacts/[contentHash]/route");

const evidenceExportAuth = {
  ok: true as const,
  auth: {
    tokenId: "token-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    connector: "acquisition-scout",
    evidenceExportGrants: [{ revisionId: "revision-1", notBefore: "2026-01-01T00:00:00.000Z" }],
  },
};

function contentHash(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("policy artifact routes", () => {
  it("rejects a mismatched claimed hash before retaining bytes", async () => {
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    const response = await postRoute.POST(
      new Request("http://localhost:3000/api/evidence/policy-artifacts", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/yaml", "x-spctre-content-hash": `sha256:${"0".repeat(64)}` },
        body: "rules: []\n",
      }),
    );

    expect(response.status).toBe(400);
    expect(retainPolicyContentArtifactSpy).not.toHaveBeenCalled();
  });

  it("retains only under the authenticated tenant and workspace", async () => {
    const bytes = new TextEncoder().encode("rules: []\n");
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    retainPolicyContentArtifactSpy.mockResolvedValue(undefined);
    const response = await postRoute.POST(
      new Request("http://localhost:3000/api/evidence/policy-artifacts", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/yaml", "x-spctre-content-hash": contentHash(bytes) },
        body: bytes,
      }),
    );

    expect(response.status).toBe(201);
    expect(runWithTenantContextSpy).toHaveBeenCalledWith("tenant-1", expect.any(Function));
    expect(retainPolicyContentArtifactSpy).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", workspaceId: "workspace-1", tokenId: "token-1", contentHash: contentHash(bytes),
    }));
  });

  it("does not reveal or load an artifact before token authorization", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({ ok: false });
    const response = await getRoute.GET(
      new Request("http://localhost:3000/api/evidence/policy-artifacts/sha256:" + "a".repeat(64)),
      { params: Promise.resolve({ contentHash: `sha256:${"a".repeat(64)}` }) },
    );

    expect(response.status).toBe(401);
    expect(readPolicyContentArtifactSpy).not.toHaveBeenCalled();
  });

  it("uses only token-bound connector and grants for an artifact read", async () => {
    const hash = `sha256:${"b".repeat(64)}`;
    authenticateServiceTokenSpy.mockResolvedValue(evidenceExportAuth);
    readPolicyContentArtifactSpy.mockResolvedValue({ bytes: new TextEncoder().encode("rules: []\n"), mediaType: "application/yaml" });
    const response = await getRoute.GET(
      new Request(`http://localhost:3000/api/evidence/policy-artifacts/${hash}`, { headers: { authorization: "Bearer token" } }),
      { params: Promise.resolve({ contentHash: hash }) },
    );

    expect(response.status).toBe(200);
    expect(readPolicyContentArtifactSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      tokenId: "token-1",
      connector: "acquisition-scout",
      grants: [{ revisionId: "revision-1", notBefore: "2026-01-01T00:00:00.000Z" }],
      contentHash: hash,
    });
    await expect(response.text()).resolves.toBe("rules: []\n");
  });
});
