import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const authenticateServiceTokenSpy = vi.fn();
const runWithTenantContextSpy = vi.fn(async (_tenantId: string, operation: () => unknown) =>
  operation(),
);
const retainPublicationContentArtifactSpy = vi.fn();
const publicationArtifactExistsSpy = vi.fn();
const insertPublicationAttestationSpy = vi.fn();
const resolvePublicationPolicyContextSpy = vi.fn();
const findTrustedPublicationSigningKeySpy = vi.fn();
const listPublicationAttestationsSpy = vi.fn();

vi.mock("@/lib/service-tokens", () => ({ authenticateServiceToken: authenticateServiceTokenSpy }));
vi.mock("@/lib/tenant-context", () => ({ runWithTenantContext: runWithTenantContextSpy }));
vi.mock("@/lib/repositories/publication-attestations", () => ({
  MAX_PUBLICATION_CONTENT_ARTIFACT_BYTES: 10 * 1024 * 1024,
  publicationContentHash: (bytes: Uint8Array) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  retainPublicationContentArtifact: retainPublicationContentArtifactSpy,
  publicationArtifactExists: publicationArtifactExistsSpy,
  insertPublicationAttestation: insertPublicationAttestationSpy,
  resolvePublicationPolicyContext: resolvePublicationPolicyContextSpy,
  findTrustedPublicationSigningKey: findTrustedPublicationSigningKeySpy,
  listPublicationAttestations: listPublicationAttestationsSpy,
}));

const artifactRoute = await import("../app/api/v1/evidence/publication-artifacts/route");
const publicationRoute = await import("../app/api/v1/evidence/publications/route");
const hash = `sha256:${"a".repeat(64)}`;
const provenance = {
  class: "attested",
  source: "review-1",
  recordedAt: "2026-08-13T18:00:00.000Z",
};
const fact = <T,>(value: T) => ({ value, provenance });
const auth = {
  ok: true as const,
  auth: { tenantId: "tenant-1", workspaceId: "workspace-1", principalId: "principal-1" },
};
const payload = {
  idempotencyKey: "publication:article-1:v1:reviewed",
  attestation: {
    schema: "spctre.publication-attestation.v1",
    attestationId: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
    content: { hash, artifactRef: hash, version: "v1", identity: "article-1", modality: "text" },
    generation: { class: fact("generated") },
    editorial: { control: fact("reviewed") },
    publisher: { entityRef: fact("entity:spctre"), role: fact("publisher") },
    disclosure: { decision: fact("not_required") },
    timestamps: { attestedAt: fact("2026-08-13T18:00:00.000Z") },
  },
};

describe("publication attestation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateServiceTokenSpy.mockResolvedValue(auth);
    publicationArtifactExistsSpy.mockResolvedValue(true);
    resolvePublicationPolicyContextSpy.mockResolvedValue({ revisionId: "revision-1" });
    insertPublicationAttestationSpy.mockResolvedValue({
      id: payload.attestation.attestationId,
      deduplicated: false,
    });
    listPublicationAttestationsSpy.mockResolvedValue([]);
  });

  it("rejects mismatched artifact bytes before retention", async () => {
    const response = await artifactRoute.POST(
      new Request("http://localhost:3000/api/v1/evidence/publication-artifacts", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "text/markdown",
          "x-spctre-content-hash": hash,
        },
        body: "# different bytes\n",
      }),
    );
    expect(response.status).toBe(400);
    expect(retainPublicationContentArtifactSpy).not.toHaveBeenCalled();
  });

  it("rejects an attestation whose artifact was not retained", async () => {
    publicationArtifactExistsSpy.mockResolvedValue(false);
    const response = await publicationRoute.POST(
      createRouteRequest({ path: "/api/v1/evidence/publications", body: payload }),
    );
    expect(response.status).toBe(400);
    expect(insertPublicationAttestationSpy).not.toHaveBeenCalled();
  });

  it("binds an attestation to the authenticated tenant and policy context", async () => {
    const response = await publicationRoute.POST(
      createRouteRequest({ path: "/api/v1/evidence/publications", body: payload }),
    );
    expect(response.status).toBe(201);
    expect(insertPublicationAttestationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        policyContext: { revisionId: "revision-1" },
      }),
    );
  });

  it("lists publication facts only for the authenticated workspace", async () => {
    const response = await publicationRoute.GET(
      new Request("http://localhost:3000/api/v1/evidence/publications?contentIdentity=article-1"),
    );
    expect(response.status).toBe(200);
    expect(listPublicationAttestationsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        contentIdentity: "article-1",
      }),
    );
  });
});
