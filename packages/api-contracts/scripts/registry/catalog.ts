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
 * That correspondence only holds if a segment can never contain a `/` or a
 * `.`, so segments are restricted to `SEGMENT_GRAMMAR` and validated at emit
 * time; see `assertCoordinates`.
 *
 * A published path is immutable by convention: a breaking change to a
 * contract ships as a new `<version>` segment, never as an edit in place.
 * That makes cataloguing a contract a public compatibility commitment, so a
 * contract still under design does not belong here yet.
 *
 * Reserved, owned elsewhere — do not claim these here:
 *   - spctre.gateway.event.v1  (gateway runtime event envelope)
 *
 * Deliberately withheld — do not re-add without the contract owner's sign-off:
 *   - the publication-attestation ingest contract and the signing-key
 *     challenge/enroll/revoke flows. Those schemas are still evolving under
 *     their own governance change; publishing them at permanent `v1` URLs
 *     would freeze a compatibility commitment the contract does not yet want
 *     to make. They will be catalogued by their owner, not by this pipeline.
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

/**
 * Grammar for a single URL/identifier segment: lowercase alphanumerics with
 * internal single hyphens. No dots (they would collide with the dotted
 * identifier form), no slashes (they would collide with the path form), no
 * uppercase (URL paths are case-sensitive and mixed case invites near-miss
 * duplicates), and no leading, trailing, or doubled hyphens.
 */
export const SEGMENT_GRAMMAR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
   * Every validation or normalization rule the Zod source applies that this
   * document does not express, enumerated. Rendered into the emitted document
   * as `$comment` so a consumer reading only the published artifact learns
   * exactly where the contract stops.
   *
   * Required for any source carrying a transform, preprocess, or custom
   * refinement — `tests/schema-registry.test.ts` fails the build if one is
   * added without a disclosure. Keep the text specific: name the affected
   * fields and the actual rule. A disclosure that describes a rule the code
   * does not implement is worse than no disclosure at all.
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

export function assertCoordinates(coordinates: ArtifactCoordinates): void {
  for (const field of ["domain", "name", "version"] as const) {
    if (!SEGMENT_GRAMMAR.test(coordinates[field])) {
      throw new Error(
        `Registry ${field} "${coordinates[field]}" is not a valid path segment (${String(SEGMENT_GRAMMAR)}).`,
      );
    }
  }
}

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
 * Shared by the three request bodies that carry pre-flight intent fields. The
 * accept limit and the retained limit differ by two orders of magnitude, which
 * is precisely the sort of thing a consumer cannot infer from the document.
 */
const INTENT_FIELD_DISCLOSURE =
  "This document describes what is accepted, not what is retained. The service then normalizes three fields in ways JSON Schema cannot express: `toolIntent` and `planSummary` are trimmed and, if still longer than 1000 and 2000 characters respectively, truncated to that length with `... [Truncated]` appended — the `maxLength` of 100000 shown here is the accept limit, not the stored length. `toolParameters` is redacted and bounded: values under secret-shaped keys (authorization, token, secret, password, credential, key, cookie, and similar) are replaced with `[REDACTED]`; string values longer than 500 characters are truncated; values that look like credentials are replaced wholesale; and traversal stops after 4 levels of nesting or 100 nodes, replacing the remainder with a truncation marker.";

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
    unrepresentable: INTENT_FIELD_DISCLOSURE,
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
    unrepresentable: INTENT_FIELD_DISCLOSURE,
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
      "Rules the service applies that this document does not express: `before` must additionally parse to a real instant, so a syntactically well-formed but non-existent date such as `2026-02-31` matches the `pattern` here and is still rejected; the accepted value is then normalized to a UTC ISO-8601 instant, so what is stored may not be byte-identical to what was sent. All three filters also accept an explicit `null` (treated as absent), and `decisionIds: []` is treated as absent rather than as an empty selector.",
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
    unrepresentable: INTENT_FIELD_DISCLOSURE,
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
      "Two rules on `checkpoint.diff` are cross-field and are not expressed here. A diff whose `format` is not `none` must carry at least one of `content`, `sha256`, or a non-empty `files`; a diff whose `format` is `none` must carry neither `content` nor a non-empty `files`. A payload valid against this document can therefore still be rejected.",
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
      'This document is both narrower and wider than what the service accepts. Narrower: `capabilities` accepts any JSON value, not only an object — anything that is not an object is replaced with `{}`, so a value the `type` shown here rejects is in fact accepted. Wider: `supportedConnectors` is filtered before it is validated — non-string items are dropped, the remaining strings are trimmed, blanks are dropped, and the result must still be non-empty, so an array that satisfies this document (for example `[42]`, `[""]`, or `["  "]`) is rejected. Also not expressed: `adapterVersion`, `environment`, and `registeredBy` are trimmed and, if blank, treated as absent, with `registeredBy` then defaulting to `api`.',
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
