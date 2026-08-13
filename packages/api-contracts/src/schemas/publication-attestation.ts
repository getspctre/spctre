import { z } from "zod";

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "Expected sha256:<hex>.");
const TimestampSchema = z.string().datetime({ offset: true });
const NonEmptyString = z.string().trim().min(1).max(512);
const EntityReferenceSchema = z
  .string()
  .regex(/^entity:[A-Za-z0-9._:-]+$/, "Expected a stable entity:<identifier> reference.");

const FactProvenanceSchema = z.object({
  class: z.enum(["observed", "attested"]),
  source: NonEmptyString,
  recordedAt: TimestampSchema,
});

const FactSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, provenance: FactProvenanceSchema });

const AssessmentSchema = z.enum(["yes", "no", "unknown", "not_assessed"]);

const DisclosureSchema = z.object({
  decision: FactSchema(z.enum(["shown", "not_required", "unknown", "not_assessed"])),
  mechanism: FactSchema(NonEmptyString).optional(),
  shownAt: FactSchema(TimestampSchema).optional(),
  accessibility: FactSchema(
    z.object({
      conformance: NonEmptyString,
      verifiedBy: NonEmptyString,
      verifiedAt: TimestampSchema,
    }),
  ).optional(),
  rationale: FactSchema(z.string().trim().min(1).max(4000)).optional(),
});

const SignedReceiptSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  signature: z.object({
    algorithm: z.literal("Ed25519"),
    keyId: NonEmptyString,
    publicKey: NonEmptyString,
    payloadHash: Sha256Schema,
    value: NonEmptyString,
  }),
});

/**
 * Normalized publication facts. Clients submit the facts and an already
 * retained content-artifact reference; the server does not fetch URLs, render
 * pages, or adjudicate a legal conclusion.
 */
export const PublicationAttestationIngestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(512),
    attestation: z.object({
      schema: z.literal("spctre.publication-attestation.v1"),
      attestationId: z.string().uuid(),
      supersedes: z.string().uuid().optional(),
      content: z.object({
        hash: Sha256Schema,
        artifactRef: Sha256Schema,
        version: NonEmptyString,
        identity: NonEmptyString,
        modality: z.enum(["text", "image", "audio", "video", "other"]),
      }),
      generation: z.object({
        provenanceRef: NonEmptyString.optional(),
        systemRef: NonEmptyString.optional(),
        class: FactSchema(
          z.enum(["generated", "manipulated", "assisted", "unknown", "not_assessed"]),
        ),
      }),
      editorial: z.object({
        editor: FactSchema(NonEmptyString).optional(),
        control: FactSchema(z.enum(["reviewed", "not_reviewed", "unknown", "not_assessed"])),
        reference: FactSchema(NonEmptyString).optional(),
        reviewedAt: FactSchema(TimestampSchema).optional(),
      }),
      publisher: z.object({
        entityRef: FactSchema(EntityReferenceSchema),
        role: FactSchema(NonEmptyString),
      }),
      classification: z
        .record(z.string().min(1).max(128), FactSchema(AssessmentSchema))
        .default({}),
      disclosure: DisclosureSchema,
      timestamps: z.object({
        generatedAt: FactSchema(TimestampSchema).optional(),
        firstExposureAt: FactSchema(TimestampSchema).optional(),
        attestedAt: FactSchema(TimestampSchema),
      }),
    }),
    receipt: SignedReceiptSchema.optional(),
  })
  .superRefine(({ attestation }, ctx) => {
    const shownAt = attestation.disclosure.shownAt?.value;
    const firstExposureAt = attestation.timestamps.firstExposureAt?.value;
    if (attestation.disclosure.decision.value === "shown" && !shownAt) {
      ctx.addIssue({
        code: "custom",
        path: ["attestation", "disclosure", "shownAt"],
        message: "A shown disclosure requires disclosure.shownAt.",
      });
    }
    if (shownAt && firstExposureAt && new Date(shownAt) > new Date(firstExposureAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["attestation", "disclosure", "shownAt"],
        message: "A disclosure cannot be shown after first exposure.",
      });
    }
  });

export type PublicationAttestationIngestInput = z.infer<typeof PublicationAttestationIngestSchema>;

export const PublicationSigningKeyChallengeSchema = z.object({
  entityRef: EntityReferenceSchema,
  keyId: NonEmptyString,
  publicKey: NonEmptyString,
});

export const PublicationSigningKeyEnrollSchema = PublicationSigningKeyChallengeSchema.extend({
  challengeId: z.string().uuid(),
  replacesKeyId: z.string().uuid().optional(),
  proof: SignedReceiptSchema.extend({
    payload: z.object({
      schema: z.literal("spctre.publication-signing-challenge.v1"),
      challengeId: z.string().uuid(),
      challenge: NonEmptyString,
    }),
  }),
});

export const PublicationSigningKeyRevokeSchema = z.object({
  reason: z.string().trim().min(1).max(512).optional(),
});
