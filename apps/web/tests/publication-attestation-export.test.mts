import { describe, expect, it } from "vitest";
import {
  filterPublicationAttestationsForExport,
  decodePublicationAttestationCursor,
  encodePublicationAttestationCursor,
  type PublicationAttestationRecord,
} from "../lib/repositories/publication-attestations";

function attestation(
  overrides: Partial<PublicationAttestationRecord>,
): PublicationAttestationRecord {
  return {
    id: "attestation-1",
    contentHash: "sha256:content",
    contentIdentity: "article-1",
    contentVersion: "v1",
    supersedesId: null,
    payloadHash: "sha256:payload",
    policyContext: { revisionId: "revision-allowed" },
    receiptVerified: true,
    attestedAt: "2026-08-13T18:00:00.000Z",
    createdAt: "2026-08-13T18:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

describe("publication attestation token export", () => {
  it("returns only facts whose policy revision and attestation time are granted", () => {
    const exported = filterPublicationAttestationsForExport(
      [
        attestation({ id: "allowed" }),
        attestation({ id: "wrong-revision", policyContext: { revisionId: "revision-other" } }),
        attestation({ id: "before-grant", attestedAt: "2026-07-01T00:00:00.000Z" }),
        attestation({ id: "after-grant", attestedAt: "2026-09-01T00:00:00.000Z" }),
      ],
      [
        {
          revisionId: "revision-allowed",
          notBefore: "2026-08-01T00:00:00.000Z",
          notAfter: "2026-08-20T00:00:00.000Z",
        },
      ],
    );

    expect(exported.map((record) => record.id)).toEqual(["allowed"]);
  });

  it("round-trips an opaque composite pagination cursor", () => {
    const cursor = {
      attestedAt: "2026-08-13T18:00:00.000Z",
      id: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
    };
    expect(decodePublicationAttestationCursor(encodePublicationAttestationCursor(cursor))).toEqual(
      cursor,
    );
    expect(() => decodePublicationAttestationCursor("not-a-cursor")).toThrow(
      "Invalid publication-attestation cursor.",
    );
  });
});
