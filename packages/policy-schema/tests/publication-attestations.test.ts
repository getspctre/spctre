import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signPayloadReceipt,
  signPublicationAttestation,
  verifyPublicationAttestation,
  verifyPublicationSigningChallenge,
} from "../src";

describe("publication attestations", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("signs and verifies a generic publication-attestation payload", () => {
    const receipt = signPublicationAttestation({
      privateKey: privatePem,
      keyId: "test-ed25519-2026",
      payload: {
        content: { hash: "sha256:abc" },
        timestamps: { attestedAt: "2026-08-13T18:00:00.000Z" },
      },
    });
    expect(verifyPublicationAttestation(receipt)).toEqual({ verified: true });
  });

  it("rejects a tampered publication-attestation payload", () => {
    const receipt = signPublicationAttestation({
      privateKey: privatePem,
      keyId: "test-ed25519-2026",
      payload: { content: { hash: "sha256:abc" } },
    });
    receipt.payload.content = { hash: "sha256:def" };
    expect(verifyPublicationAttestation(receipt)).toEqual({
      verified: false,
      reason: "Payload hash mismatch.",
    });
  });

  it("verifies a signing-key proof-of-possession challenge", () => {
    const receipt = signPayloadReceipt({
      privateKey: privatePem,
      keyId: "test-ed25519-2026",
      payload: {
        schema: "spctre.publication-signing-challenge.v1" as const,
        challengeId: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
        challenge: "challenge-value",
      },
    });
    expect(verifyPublicationSigningChallenge(receipt)).toEqual({ verified: true });
  });
});
