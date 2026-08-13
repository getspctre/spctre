import { describe, expect, it } from "vitest";
import {
  decodePublicationAttestationCursor,
  encodePublicationAttestationCursor,
} from "../lib/repositories/publication-attestations";

describe("publication attestation pagination", () => {
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
