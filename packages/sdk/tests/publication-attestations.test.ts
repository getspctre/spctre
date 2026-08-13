import { describe, expect, it, vi } from "vitest";
import {
  publicationContentHash,
  retainPublicationContentArtifact,
  signPublicationFacts,
  submitPublicationAttestation,
} from "../src/publication-attestations";

const fact = <T>(value: T) => ({
  value,
  provenance: {
    class: "attested" as const,
    source: "test",
    recordedAt: "2026-08-13T18:00:00.000Z",
  },
});
const payload = {
  schema: "spctre.publication-attestation.v1" as const,
  attestationId: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
  content: {
    hash: `sha256:${"a".repeat(64)}`,
    artifactRef: `sha256:${"a".repeat(64)}`,
    version: "v1",
    identity: "article-1",
    modality: "text" as const,
  },
  generation: { class: fact("generated" as const) },
  editorial: { control: fact("reviewed" as const) },
  publisher: { entityRef: fact("entity:spctre"), role: fact("publisher") },
  disclosure: { decision: fact("not_required" as const) },
  timestamps: { attestedAt: fact("2026-08-13T18:00:00.000Z") },
};

describe("publication attestation SDK helpers", () => {
  it("hashes exact bytes and retains them with the claimed hash header", async () => {
    const bytes = new TextEncoder().encode("hello");
    await expect(publicationContentHash(bytes)).resolves.toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    const POST = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    await retainPublicationContentArtifact({ POST } as never, bytes);
    expect(POST).toHaveBeenCalledWith(
      "/evidence/publication-artifacts",
      expect.objectContaining({ params: { header: expect.any(Object) } }),
    );
  });

  it("canonicalizes facts for caller-provided signing and submits the receipt", async () => {
    const sign = vi.fn().mockResolvedValue("signature");
    const receipt = await signPublicationFacts({
      payload,
      keyId: "key-1",
      publicKey: "public-key",
      sign,
    });
    expect(sign).toHaveBeenCalledOnce();
    expect(receipt.signature.payloadHash).toMatch(/^sha256:/);
    const POST = vi
      .fn()
      .mockResolvedValue({ data: { attestationId: payload.attestationId }, error: undefined });
    await submitPublicationAttestation({ POST } as never, {
      idempotencyKey: "publication:article-1:v1",
      attestation: payload,
      receipt,
    });
    expect(POST).toHaveBeenCalledWith("/evidence/publications", expect.any(Object));
  });
});
