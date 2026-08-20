/**
 * The schema registry catalog — the single enumeration of every document
 * published to https://schema.spctre.dev/.
 *
 * This module is deliberately data-only so that adding a contract is a
 * self-contained append: import the source, push one entry, done. Emission,
 * digesting, and manifest assembly all live in `./emit.ts` and never need to
 * change when the catalog grows.
 *
 * URL layout (see `artifactUrl`):
 *
 *     https://schema.spctre.dev/<domain>/<name>/<version>.json
 *
 * The three segments are also the artifact identifier, dotted and prefixed:
 * `spctre.<domain>.<name>.<version>` — so `spctre.evidence.ingest.v1` and
 * https://schema.spctre.dev/evidence/ingest/v1.json name the same document.
 * A published path is immutable by convention: a breaking change to a
 * contract ships as a new `<version>` segment, never as an edit in place.
 *
 * Reserved, owned elsewhere — do not claim these here:
 *   - spctre.gateway.event.v1  (gateway runtime event envelope)
 */

import type { ZodType } from "zod";

import {
  AdapterDeclarationSchema,
  CanonicalEnforcementDecisionSchema,
  EvaluateSchema,
  EvidenceEraseRequestSchema,
  EvidenceFieldMappingSchema,
  EvidenceIngestSchema,
  GatewayDecisionSchema,
  GatewayResolveSchema,
  GitCheckpointIngestSchema,
  PublicationAttestationIngestSchema,
  PublicationSigningKeyChallengeSchema,
  PublicationSigningKeyEnrollSchema,
  PublicationSigningKeyRevokeSchema,
  RuntimeStackSchema,
  TokenPairResponseSchema,
  TokenRefreshSchema,
} from "../../src/index.js";

/** Canonical registry origin. Every emitted `$id` resolves under it. */
export const REGISTRY_BASE = "https://schema.spctre.dev";

/** JSON Schema dialect every emitted schema document declares. */
export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** Directory (repo-relative) the Zod-derived documents are written into. */
export const EMIT_ROOT = "packages/api-contracts/schemas";

/** Coordinates shared by every registry member. */
interface ArtifactCoordinates {
  /** First URL segment: the contract family. */
  domain: string;
  /** Second URL segment: the contract name within its family. */
  name: string;
  /** Third URL segment: `v<major>` for schemas, `info.version` for the spec. */
  version: string;
}

/** A document generated from a Zod schema in `src/schemas/`. */
export interface ZodArtifact extends ArtifactCoordinates {
  kind: "json-schema";
  source: "zod";
  title: string;
  description: string;
  schema: ZodType;
  /**
   * Constraints the Zod source enforces that JSON Schema cannot express.
   * Rendered into the emitted document as `$comment` so a consumer reading
   * only the published artifact still learns the contract is not exhaustive.
   */
  unrepresentable?: string;
}

/**
 * A document that already exists as a checked-in file. It is published as-is;
 * the manifest records where the publisher reads it from and what it hashes
 * to. Nothing is copied into `EMIT_ROOT`, so the file has exactly one
 * on-disk representation and cannot drift against a duplicate.
 */
export interface FileArtifact extends ArtifactCoordinates {
  kind: "json-schema" | "openapi";
  source: "file";
  title: string;
  description: string;
  /** Repo-relative path of the file to publish. */
  path: string;
}

export type RegistryArtifact = ZodArtifact | FileArtifact;

export function artifactId(coordinates: ArtifactCoordinates): string {
  return `spctre.${coordinates.domain}.${coordinates.name}.${coordinates.version}`;
}

export function artifactUrl(coordinates: ArtifactCoordinates): string {
  return `${REGISTRY_BASE}/${coordinates.domain}/${coordinates.name}/${coordinates.version}.json`;
}

export function artifactPath(artifact: RegistryArtifact): string {
  return artifact.source === "file"
    ? artifact.path
    : `${EMIT_ROOT}/${artifact.domain}/${artifact.name}/${artifact.version}.json`;
}

/**
 * The catalog. Ordering here is irrelevant — the emitter sorts by identifier —
 * so append new entries wherever they read best.
 */
export const REGISTRY_ARTIFACTS: RegistryArtifact[] = [
  {
    kind: "json-schema",
    source: "zod",
    domain: "evidence",
    name: "ingest",
    version: "v1",
    title: "Evidence Ingest Request",
    description:
      "Body accepted by POST /api/v1/evidence: one governed runtime action recorded as evidence.",
    schema: EvidenceIngestSchema,
    unrepresentable:
      "The Zod source additionally sanitizes `action`, `resource`, and `parameters` on ingest (bounding length and redacting secret-shaped values). Those transforms are not expressible in JSON Schema, so a payload valid against this document may still be stored in normalized form.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "evidence",
    name: "evaluate",
    version: "v1",
    title: "Decision Evaluation Request",
    description:
      "Body accepted by POST /api/v1/decision/evaluate: a proposed action submitted for a governance decision.",
    schema: EvaluateSchema,
    unrepresentable:
      "The Zod source additionally sanitizes `action`, `resource`, and `parameters`. Those transforms are not expressible in JSON Schema.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "evidence",
    name: "erase-request",
    version: "v1",
    title: "Evidence Erasure Request",
    description: "Body accepted by the evidence erasure endpoint (right-to-erasure workflows).",
    schema: EvidenceEraseRequestSchema,
    unrepresentable:
      "The Zod source additionally requires `before` to parse as a real calendar date and normalizes it to an ISO-8601 instant, and coerces empty selectors to absent. This document constrains only the string format.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "evidence",
    name: "runtime-stack",
    version: "v1",
    title: "Runtime Stack",
    description:
      "Closed vocabulary of enforcement runtimes an evidence record or decision may originate from.",
    schema: RuntimeStackSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "evidence",
    name: "enforcement-decision",
    version: "v1",
    title: "Canonical Enforcement Decision",
    description: "Closed vocabulary every adapter normalizes a runtime's native verdict into.",
    schema: CanonicalEnforcementDecisionSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "evidence",
    name: "field-mapping",
    version: "v1",
    title: "Generic Evidence Field Mapping",
    description:
      "Declarative mapping that projects an arbitrary runtime payload onto the canonical evidence shape.",
    schema: EvidenceFieldMappingSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "gateway",
    name: "decision-request",
    version: "v1",
    title: "Gateway Decision Request",
    description:
      "Body accepted by POST /api/gateway/decide: the pre-action check a governed agent makes before acting.",
    schema: GatewayDecisionSchema,
    unrepresentable:
      "The Zod source additionally sanitizes `action`, `resource`, and `parameters`. Those transforms are not expressible in JSON Schema.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "gateway",
    name: "resolve-request",
    version: "v1",
    title: "Gateway Resolution Request",
    description: "Body accepted when resolving a previously escalated gateway decision.",
    schema: GatewayResolveSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "git",
    name: "checkpoint-ingest",
    version: "v1",
    title: "Git Checkpoint Ingest Request",
    description: "Body accepted when recording a git checkpoint as evidence of an agent's change.",
    schema: GitCheckpointIngestSchema,
    unrepresentable:
      "The Zod source additionally rejects diffs whose cumulative size exceeds the ingest budget, via a cross-field refinement this document cannot express.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "publication",
    name: "attestation-ingest",
    version: "v1",
    title: "Publication Attestation Ingest Request",
    description: "Body accepted when submitting a signed publication attestation.",
    schema: PublicationAttestationIngestSchema,
    unrepresentable:
      "The Zod source additionally cross-checks the attestation against the declared signing algorithm and signature encoding. That refinement is not expressible in JSON Schema.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "publication",
    name: "signing-key-challenge",
    version: "v1",
    title: "Publication Signing Key Challenge Request",
    description: "Body accepted when requesting an enrollment challenge for a signing key.",
    schema: PublicationSigningKeyChallengeSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "publication",
    name: "signing-key-enroll",
    version: "v1",
    title: "Publication Signing Key Enrollment Request",
    description: "Body accepted when enrolling a signing key against an issued challenge.",
    schema: PublicationSigningKeyEnrollSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "publication",
    name: "signing-key-revoke",
    version: "v1",
    title: "Publication Signing Key Revocation Request",
    description: "Body accepted when revoking an enrolled signing key.",
    schema: PublicationSigningKeyRevokeSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "adapter",
    name: "declaration",
    version: "v1",
    title: "Adapter Declaration",
    description:
      "Self-description an enforcement-runtime adapter presents when registering with the control plane.",
    schema: AdapterDeclarationSchema,
    unrepresentable:
      "The Zod source additionally normalizes blank strings to absent, de-duplicates the declared capability list, and defaults the surface to `api`. Those transforms are not expressible in JSON Schema.",
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "token",
    name: "refresh-request",
    version: "v1",
    title: "Token Refresh Request",
    description: "Body accepted when exchanging a refresh token for a new access token pair.",
    schema: TokenRefreshSchema,
  },
  {
    kind: "json-schema",
    source: "zod",
    domain: "token",
    name: "pair-response",
    version: "v1",
    title: "Token Pair Response",
    description: "Access/refresh token pair returned by the token endpoints.",
    schema: TokenPairResponseSchema,
  },

  // ── Documents that already exist on disk ────────────────────────────────
  {
    kind: "json-schema",
    source: "file",
    domain: "policy",
    name: "bundle",
    version: "v1",
    title: "Spctre Managed Governance Policy Bundle",
    description:
      "Hand-authored JSON Schema for the compiled policy bundle an enforcement runtime loads.",
    path: "packages/policy-schema/schemas/policy.schema.json",
  },
  {
    kind: "openapi",
    source: "file",
    domain: "openapi",
    name: "spctre-api",
    version: "2026-01",
    title: "Spctre API",
    description:
      "OpenAPI 3.1 description of the public /api/v1/ surface. The version segment is `info.version`, which is frozen; revisions within it are identified by the spec's `x-spctre-spec-revision`.",
    path: "packages/api-contracts/openapi.json",
  },
];
