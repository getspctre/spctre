import { describe, expect, it } from "vitest";
import { parseBody, PublicationAttestationIngestSchema } from "../src";

const provenance = {
  class: "attested",
  source: "review-1",
  recordedAt: "2026-08-13T18:00:00.000Z",
};
const fact = <T>(value: T) => ({ value, provenance });

const valid = {
  idempotencyKey: "publication:article-1:v1:reviewed",
  attestation: {
    schema: "spctre.publication-attestation.v1",
    attestationId: "9d98fb1a-aeb8-49e9-9b56-b11f3d1c505b",
    content: {
      hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      artifactRef: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      version: "v1",
      identity: "article-1",
      modality: "text",
    },
    generation: { class: fact("generated") },
    editorial: { control: fact("reviewed") },
    publisher: { entityRef: fact("entity:spctre"), role: fact("publisher") },
    disclosure: { decision: fact("not_required") },
    timestamps: { attestedAt: fact("2026-08-13T18:00:00.000Z") },
  },
};

describe("PublicationAttestationIngestSchema", () => {
  it("accepts normalized, hash-bound publication facts", () => {
    expect(parseBody(PublicationAttestationIngestSchema, valid).ok).toBe(true);
  });

  it("requires per-fact provenance", () => {
    const result = parseBody(PublicationAttestationIngestSchema, {
      ...valid,
      attestation: { ...valid.attestation, editorial: { control: { value: "reviewed" } } },
    });
    expect(result.ok).toBe(false);
  });

  it("requires a shown disclosure timestamp and preserves first-exposure ordering", () => {
    const shownWithoutTimestamp = parseBody(PublicationAttestationIngestSchema, {
      ...valid,
      attestation: { ...valid.attestation, disclosure: { decision: fact("shown") } },
    });
    expect(shownWithoutTimestamp.ok).toBe(false);

    const shownAfterExposure = parseBody(PublicationAttestationIngestSchema, {
      ...valid,
      attestation: {
        ...valid.attestation,
        disclosure: { decision: fact("shown"), shownAt: fact("2026-08-13T19:00:00.000Z") },
        timestamps: {
          ...valid.attestation.timestamps,
          firstExposureAt: fact("2026-08-13T18:30:00.000Z"),
        },
      },
    });
    expect(shownAfterExposure.ok).toBe(false);
  });

  it("requires a stable publisher entity reference", () => {
    const result = parseBody(PublicationAttestationIngestSchema, {
      ...valid,
      attestation: {
        ...valid.attestation,
        publisher: { ...valid.attestation.publisher, entityRef: fact("Spctre") },
      },
    });
    expect(result.ok).toBe(false);
  });
});
