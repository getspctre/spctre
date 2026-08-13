import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const authenticateServiceTokenSpy = vi.fn();
const createChallengeSpy = vi.fn();
const consumeChallengeSpy = vi.fn();
const revokeKeySpy = vi.fn();
const listKeysSpy = vi.fn();

vi.mock("@/lib/service-tokens", () => ({ authenticateServiceToken: authenticateServiceTokenSpy }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: vi.fn(async (_tenantId: string, operation: () => unknown) => operation()),
}));
vi.mock("@/lib/repositories/publication-attestations", () => ({
  createPublicationSigningChallenge: createChallengeSpy,
  consumePublicationSigningChallenge: consumeChallengeSpy,
  revokePublicationSigningKey: revokeKeySpy,
  listPublicationSigningKeys: listKeysSpy,
}));
vi.mock("@spctre/policy-schema", () => ({
  verifyPublicationSigningChallenge: vi.fn(() => ({ verified: true })),
}));

const challengeRoute =
  await import("../app/api/v1/evidence/publication-signing-keys/challenges/route");
const keyRoute = await import("../app/api/v1/evidence/publication-signing-keys/route");
const keyDetailRoute = await import("../app/api/v1/evidence/publication-signing-keys/[id]/route");

const auth = {
  ok: true as const,
  auth: { tenantId: "tenant-1", workspaceId: "workspace-1", principalId: "principal-1" },
};
const enrollment = {
  entityRef: "entity:spctre",
  keyId: "editorial-key-2026",
  publicKey: "public-key",
  challengeId: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
  proof: {
    payload: {
      schema: "spctre.publication-signing-challenge.v1",
      challengeId: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
      challenge: "challenge-value",
    },
    signature: {
      algorithm: "Ed25519",
      keyId: "editorial-key-2026",
      publicKey: "public-key",
      payloadHash: `sha256:${"a".repeat(64)}`,
      value: "signature",
    },
  },
};

describe("publication signing-key routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateServiceTokenSpy.mockResolvedValue(auth);
    createChallengeSpy.mockResolvedValue({
      id: enrollment.challengeId,
      challenge: "challenge-value",
    });
    consumeChallengeSpy.mockResolvedValue({ id: "key-id", keyId: enrollment.keyId });
    revokeKeySpy.mockResolvedValue(true);
    listKeysSpy.mockResolvedValue([]);
  });

  it("creates a possession challenge in the authenticated workspace", async () => {
    const response = await challengeRoute.POST(
      createRouteRequest({
        path: "/api/v1/evidence/publication-signing-keys/challenges",
        body: enrollment,
      }),
    );
    expect(response.status).toBe(201);
    expect(createChallengeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", workspaceId: "workspace-1" }),
    );
  });

  it("authenticates before validating signing-key mutation bodies", async () => {
    authenticateServiceTokenSpy.mockResolvedValue({ ok: false, error: "Unauthorized" });

    const challengeResponse = await challengeRoute.POST(
      createRouteRequest({
        path: "/api/v1/evidence/publication-signing-keys/challenges",
        body: {},
      }),
    );
    const enrollResponse = await keyRoute.POST(
      createRouteRequest({ path: "/api/v1/evidence/publication-signing-keys", body: {} }),
    );
    const revokeResponse = await keyDetailRoute.DELETE(
      createRouteRequest({
        path: "/api/v1/evidence/publication-signing-keys/key-id",
        method: "DELETE",
        body: { reason: 42 },
      }),
      { params: Promise.resolve({ id: "key-id" }) },
    );

    expect([challengeResponse.status, enrollResponse.status, revokeResponse.status]).toEqual([
      401, 401, 401,
    ]);
    expect(createChallengeSpy).not.toHaveBeenCalled();
    expect(consumeChallengeSpy).not.toHaveBeenCalled();
    expect(revokeKeySpy).not.toHaveBeenCalled();
  });

  it("requires the signed challenge to bind the requested enrollment", async () => {
    const response = await keyRoute.POST(
      createRouteRequest({ path: "/api/v1/evidence/publication-signing-keys", body: enrollment }),
    );
    expect(response.status).toBe(201);
    expect(consumeChallengeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: "challenge-value", enrolledBy: "principal-1" }),
    );
  });

  it("lists and revokes only scoped keys", async () => {
    const listResponse = await keyRoute.GET(
      createRouteRequest({
        path: "/api/v1/evidence/publication-signing-keys?entityRef=entity:spctre",
        method: "GET",
      }),
    );
    expect(listResponse.status).toBe(200);
    expect(listKeysSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1" }),
    );
    const revokeResponse = await keyDetailRoute.DELETE(
      createRouteRequest({
        path: "/api/v1/evidence/publication-signing-keys/key-id",
        method: "DELETE",
        body: { reason: "rotated" },
      }),
      { params: Promise.resolve({ id: "key-id" }) },
    );
    expect(revokeResponse.status).toBe(200);
    expect(revokeKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({ revokedBy: "principal-1" }),
    );
  });
});
