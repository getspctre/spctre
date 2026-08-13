import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canonicalizeReceiptPayload } from "@spctre/policy-schema";
import type { PublicationAttestationIngestInput } from "@spctre/api-contracts";
import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";
import { appendOperationsLogInTransaction } from "@/lib/repositories/operations-log";

export const MAX_PUBLICATION_CONTENT_ARTIFACT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["application/octet-stream"]);

function encryptionKey(): string {
  const key = process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set.");
  return key;
}

export function publicationContentHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function retainPublicationContentArtifact(params: {
  contentHash: string;
  bytes: Uint8Array;
  mediaType: string;
  tenantId: string;
  workspaceId: string;
}): Promise<void> {
  if (!sql) throw new Error("Database not configured.");
  if (params.bytes.byteLength > MAX_PUBLICATION_CONTENT_ARTIFACT_BYTES)
    throw new Error(
      `Publication artifact exceeds ${MAX_PUBLICATION_CONTENT_ARTIFACT_BYTES} byte limit.`,
    );
  if (!ALLOWED_MEDIA_TYPES.has(params.mediaType))
    throw new Error("Unsupported publication artifact media type.");
  if (publicationContentHash(params.bytes) !== params.contentHash)
    throw new Error("Publication artifact content hash mismatch.");
  await sql`
    INSERT INTO publication_content_artifact
      (tenant_id, workspace_id, content_hash, media_type, size_bytes, content_encrypted)
    VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.contentHash}, ${params.mediaType},
      ${params.bytes.byteLength}, pgp_sym_encrypt_bytea(${Buffer.from(params.bytes)}, ${encryptionKey()})
    )
    ON CONFLICT (tenant_id, workspace_id, content_hash) DO NOTHING
  `;
}

export async function insertPublicationAttestation(params: {
  tenantId: string;
  workspaceId: string;
  idempotencyKey: string;
  attestation: PublicationAttestationIngestInput["attestation"];
  receipt?: Record<string, unknown>;
  receiptVerified: boolean;
  policyContext: Record<string, string>;
}): Promise<{ id: string; deduplicated: boolean }> {
  if (!sql) throw new Error("Database not configured.");
  const payloadHash = publicationContentHash(
    new TextEncoder().encode(canonicalizeReceiptPayload(params.attestation)),
  );
  const content = params.attestation.content;
  const timestamps = params.attestation.timestamps;
  const supersedes =
    typeof params.attestation.supersedes === "string" ? params.attestation.supersedes : null;
  const rows = await sql.begin(async (tx) => {
    if (supersedes) {
      const prior = await tx<{ content_identity: string }[]>`
        SELECT content_identity
        FROM publication_attestation
        WHERE id = ${supersedes}
          AND tenant_id = ${params.tenantId}
          AND workspace_id = ${params.workspaceId}
        LIMIT 1
      `;
      if (!prior[0])
        throw new Error("Superseded publication attestation was not found in this workspace.");
      if (prior[0].content_identity !== content.identity)
        throw new Error("A publication attestation can supersede only the same content identity.");
    }
    const receipt = params.receipt ? tx.json(params.receipt as unknown as JSONValue) : null;
    const inserted = await tx<{ id: string }[]>`
    INSERT INTO publication_attestation (
      id, tenant_id, workspace_id, idempotency_key, content_hash, content_identity,
      content_version, supersedes_id, payload_hash, policy_context, payload, signed_receipt,
      receipt_verified, attested_at
    ) VALUES (
      ${randomUUID()}, ${params.tenantId}, ${params.workspaceId},
      ${params.idempotencyKey}, ${content.hash as string}, ${content.identity as string},
      ${content.version as string}, ${supersedes}, ${payloadHash}, ${tx.json(params.policyContext as unknown as JSONValue)},
      ${tx.json(params.attestation as unknown as JSONValue)}, ${receipt}::jsonb,
      ${params.receiptVerified}, ${timestamps.attestedAt.value}
    )
    ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO NOTHING
    RETURNING id
    `;
    return inserted;
  });
  if (rows[0]) return { id: rows[0].id, deduplicated: false };
  const existing = await sql<{ id: string; payload_hash: string }[]>`
    SELECT id, payload_hash FROM publication_attestation
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND idempotency_key = ${params.idempotencyKey}
    LIMIT 1
  `;
  if (!existing[0]) throw new Error("Publication attestation idempotency lookup failed.");
  if (existing[0].payload_hash !== payloadHash)
    throw new Error("Idempotency key is already bound to different publication facts.");
  return { id: existing[0].id, deduplicated: true };
}

export async function publicationArtifactExists(params: {
  tenantId: string;
  workspaceId: string;
  contentHash: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ found: boolean }[]>`
    SELECT true AS found FROM publication_content_artifact
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND content_hash = ${params.contentHash}
    LIMIT 1
  `;
  return Boolean(rows[0]?.found);
}

export async function resolvePublicationPolicyContext(params: {
  tenantId: string;
  workspaceId: string;
  at: string;
}): Promise<Record<string, string>> {
  if (!sql) return {};
  const rows = await sql<
    { publish_id: string; branch_id: string; revision_id: string; artifact_hash: string }[]
  >`
    SELECT pp.id AS publish_id, pp.branch_id, pp.revision_id, pp.artifact_hash
    FROM policy_publish pp
    JOIN policy_branch pb ON pb.id = pp.branch_id AND pb.tenant_id = pp.tenant_id
    WHERE pp.tenant_id = ${params.tenantId}
      AND (pp.workspace_id = ${params.workspaceId} OR pb.scope = 'ORGANIZATION')
      AND pp.published_at <= ${params.at}::timestamptz
    ORDER BY pp.published_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        publishId: row.publish_id,
        branchId: row.branch_id,
        revisionId: row.revision_id,
        artifactHash: row.artifact_hash,
      }
    : {};
}

export interface PublicationAttestationRecord {
  id: string;
  contentHash: string;
  contentIdentity: string;
  contentVersion: string;
  supersedesId: string | null;
  payloadHash: string;
  policyContext: Record<string, string>;
  receiptVerified: boolean;
  attestedAt: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

function publicationRecord(row: {
  id: string;
  content_hash: string;
  content_identity: string;
  content_version: string;
  supersedes_id: string | null;
  payload_hash: string;
  policy_context: Record<string, string>;
  receipt_verified: boolean;
  attested_at: Date;
  created_at: Date;
  payload: Record<string, unknown>;
}): PublicationAttestationRecord {
  return {
    id: row.id,
    contentHash: row.content_hash,
    contentIdentity: row.content_identity,
    contentVersion: row.content_version,
    supersedesId: row.supersedes_id,
    payloadHash: row.payload_hash,
    policyContext: row.policy_context ?? {},
    receiptVerified: row.receipt_verified,
    attestedAt: row.attested_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    payload: row.payload,
  };
}

export async function listPublicationAttestations(params: {
  tenantId: string;
  workspaceId: string | null;
  contentIdentity?: string;
  limit: number;
  before?: PublicationAttestationCursor;
}): Promise<PublicationAttestationRecord[]> {
  if (!sql) return [];
  const rows = await sql<Parameters<typeof publicationRecord>[0][]>`
    SELECT id, content_hash, content_identity, content_version, supersedes_id, payload_hash,
      policy_context, receipt_verified, attested_at, created_at, payload
    FROM publication_attestation
    WHERE tenant_id = ${params.tenantId}
      AND (${params.workspaceId}::uuid IS NULL OR workspace_id = ${params.workspaceId}::uuid)
      AND (${params.contentIdentity ?? null}::text IS NULL OR content_identity = ${params.contentIdentity ?? null})
      AND (
        ${params.before?.attestedAt ?? null}::timestamptz IS NULL
        OR attested_at < ${params.before?.attestedAt ?? null}::timestamptz
        OR (
          attested_at = ${params.before?.attestedAt ?? null}::timestamptz
          AND id < ${params.before?.id ?? null}::uuid
        )
      )
    ORDER BY attested_at DESC, id DESC
    LIMIT ${params.limit}
  `;
  return rows.map(publicationRecord);
}

export interface PublicationAttestationCursor {
  attestedAt: string;
  id: string;
}

export function encodePublicationAttestationCursor(cursor: PublicationAttestationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodePublicationAttestationCursor(
  encoded: string | undefined,
): PublicationAttestationCursor | undefined {
  if (!encoded) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).attestedAt !== "string" ||
      Number.isNaN(new Date((parsed as Record<string, string>).attestedAt).getTime()) ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        (parsed as Record<string, string>).id,
      )
    )
      throw new Error("Invalid publication-attestation cursor.");
    return parsed as PublicationAttestationCursor;
  } catch {
    throw new Error("Invalid publication-attestation cursor.");
  }
}

export function filterPublicationAttestationsForExport(
  attestations: PublicationAttestationRecord[],
  grants: Array<{ revisionId: string; notBefore: string; notAfter?: string }>,
): PublicationAttestationRecord[] {
  return attestations.filter((attestation) =>
    grants.some((grant) => {
      const attestedAt = new Date(attestation.attestedAt).getTime();
      return (
        attestation.policyContext.revisionId === grant.revisionId &&
        attestedAt >= new Date(grant.notBefore).getTime() &&
        (!grant.notAfter || attestedAt < new Date(grant.notAfter).getTime())
      );
    }),
  );
}

export async function getPublicationAttestation(params: {
  tenantId: string;
  workspaceId: string;
  id: string;
}): Promise<PublicationAttestationRecord | null> {
  if (!sql) return null;
  const rows = await sql<Parameters<typeof publicationRecord>[0][]>`
    SELECT id, content_hash, content_identity, content_version, supersedes_id, payload_hash,
      policy_context, receipt_verified, attested_at, created_at, payload
    FROM publication_attestation
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId} AND id = ${params.id}
    LIMIT 1
  `;
  return rows[0] ? publicationRecord(rows[0]) : null;
}

export async function readPublicationContentArtifact(params: {
  tenantId: string;
  workspaceId: string;
  contentHash: string;
}): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ media_type: string; bytes: Buffer }[]>`
    SELECT media_type, pgp_sym_decrypt_bytea(content_encrypted, ${encryptionKey()}) AS bytes
    FROM publication_content_artifact
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
      AND content_hash = ${params.contentHash}
    LIMIT 1
  `;
  return rows[0] ? { bytes: new Uint8Array(rows[0].bytes), mediaType: rows[0].media_type } : null;
}

export interface PublicationSigningKeyRecord {
  id: string;
  entityRef: string;
  keyId: string;
  publicKey: string;
  ownershipVerifiedAt: string;
  revokedAt: string | null;
  replacesKeyId: string | null;
}

function signingKeyRecord(row: {
  id: string;
  entity_ref: string;
  key_id: string;
  public_key: string;
  ownership_verified_at: Date;
  revoked_at: Date | null;
  replaces_key_id: string | null;
}): PublicationSigningKeyRecord {
  return {
    id: row.id,
    entityRef: row.entity_ref,
    keyId: row.key_id,
    publicKey: row.public_key,
    ownershipVerifiedAt: row.ownership_verified_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    replacesKeyId: row.replaces_key_id,
  };
}

export async function createPublicationSigningChallenge(params: {
  tenantId: string;
  workspaceId: string;
  entityRef: string;
  keyId: string;
  publicKey: string;
}): Promise<{ id: string; challenge: string; expiresAt: string }> {
  if (!sql) throw new Error("Database not configured.");
  const id = randomUUID();
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await sql`
    INSERT INTO publication_attestation_signing_challenge
      (id, tenant_id, workspace_id, entity_ref, key_id, public_key, challenge, expires_at)
    VALUES (${id}, ${params.tenantId}, ${params.workspaceId}, ${params.entityRef}, ${params.keyId}, ${params.publicKey}, ${challenge}, ${expiresAt})
    ON CONFLICT (tenant_id, workspace_id, key_id, public_key) DO UPDATE SET
      id = EXCLUDED.id,
      entity_ref = EXCLUDED.entity_ref,
      challenge = EXCLUDED.challenge,
      expires_at = EXCLUDED.expires_at,
      consumed_at = NULL,
      created_at = now()
  `;
  return { id, challenge, expiresAt };
}

export async function consumePublicationSigningChallenge(params: {
  tenantId: string;
  workspaceId: string;
  challengeId: string;
  entityRef: string;
  keyId: string;
  publicKey: string;
  challenge: string;
  enrolledBy: string;
  replacesKeyId?: string;
}): Promise<PublicationSigningKeyRecord> {
  if (!sql) throw new Error("Database not configured.");
  return sql.begin(async (tx) => {
    const challenges = await tx<{ challenge: string }[]>`
      UPDATE publication_attestation_signing_challenge SET consumed_at = now()
      WHERE id = ${params.challengeId} AND tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId} AND entity_ref = ${params.entityRef}
        AND key_id = ${params.keyId} AND public_key = ${params.publicKey}
        AND challenge = ${params.challenge}
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING challenge
    `;
    if (!challenges[0])
      throw new Error("Signing-key challenge is invalid, expired, or already used.");
    if (params.replacesKeyId) {
      const prior = await tx<{ id: string; entity_ref: string; revoked_at: Date | null }[]>`
        SELECT id, entity_ref, revoked_at FROM publication_attestation_signing_key
        WHERE id = ${params.replacesKeyId} AND tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
        LIMIT 1
      `;
      if (!prior[0] || prior[0].entity_ref !== params.entityRef || prior[0].revoked_at)
        throw new Error("Replacement signing key must replace an active key for the same entity.");
    }
    const rows = await tx<Parameters<typeof signingKeyRecord>[0][]>`
      INSERT INTO publication_attestation_signing_key
        (id, tenant_id, workspace_id, entity_ref, key_id, public_key, ownership_verified_at, enrolled_by, replaces_key_id)
      VALUES (${randomUUID()}, ${params.tenantId}, ${params.workspaceId}, ${params.entityRef}, ${params.keyId}, ${params.publicKey}, now(), ${params.enrolledBy}, ${params.replacesKeyId ?? null})
      RETURNING id, entity_ref, key_id, public_key, ownership_verified_at, revoked_at, replaces_key_id
    `;
    if (params.replacesKeyId)
      await tx`
      UPDATE publication_attestation_signing_key
      SET revoked_at = now(), revoked_by = ${params.enrolledBy}, revocation_reason = 'rotated'
      WHERE id = ${params.replacesKeyId} AND tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
    `;
    const key = signingKeyRecord(rows[0]!);
    await appendOperationsLogInTransaction(tx, {
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "IDENTITY_CHANGE",
      sourceId: key.id,
      sourceTable: "publication_attestation_signing_key",
      actorId: params.enrolledBy,
      payload: {
        kind: params.replacesKeyId
          ? "PUBLICATION_SIGNING_KEY_ROTATED"
          : "PUBLICATION_SIGNING_KEY_ENROLLED",
        entityRef: key.entityRef,
        keyId: key.keyId,
        replacesKeyId: params.replacesKeyId ?? null,
        ownershipVerifiedAt: key.ownershipVerifiedAt,
      },
    });
    return key;
  });
}

export async function findTrustedPublicationSigningKey(params: {
  tenantId: string;
  workspaceId: string;
  entityRef: string;
  keyId: string;
  publicKey: string;
}): Promise<PublicationSigningKeyRecord | null> {
  if (!sql) return null;
  const rows = await sql<Parameters<typeof signingKeyRecord>[0][]>`
    SELECT id, entity_ref, key_id, public_key, ownership_verified_at, revoked_at, replaces_key_id
    FROM publication_attestation_signing_key
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
      AND entity_ref = ${params.entityRef} AND key_id = ${params.keyId}
      AND public_key = ${params.publicKey} AND revoked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? signingKeyRecord(rows[0]) : null;
}

export async function listPublicationSigningKeys(params: {
  tenantId: string;
  workspaceId: string;
  entityRef?: string;
}): Promise<PublicationSigningKeyRecord[]> {
  if (!sql) return [];
  const rows = await sql<Parameters<typeof signingKeyRecord>[0][]>`
    SELECT id, entity_ref, key_id, public_key, ownership_verified_at, revoked_at, replaces_key_id
    FROM publication_attestation_signing_key
    WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
      AND (${params.entityRef ?? null}::text IS NULL OR entity_ref = ${params.entityRef ?? null})
    ORDER BY created_at DESC
  `;
  return rows.map(signingKeyRecord);
}

export async function revokePublicationSigningKey(params: {
  tenantId: string;
  workspaceId: string;
  keyId: string;
  revokedBy: string;
  reason?: string;
}): Promise<boolean> {
  if (!sql) throw new Error("Database not configured.");
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; entity_ref: string; key_id: string }[]>`
      UPDATE publication_attestation_signing_key
      SET revoked_at = now(), revoked_by = ${params.revokedBy}, revocation_reason = ${params.reason ?? null}
      WHERE id = ${params.keyId} AND tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
        AND revoked_at IS NULL
      RETURNING id, entity_ref, key_id
    `;
    const key = rows[0];
    if (!key) return false;
    await appendOperationsLogInTransaction(tx, {
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      eventType: "IDENTITY_CHANGE",
      sourceId: key.id,
      sourceTable: "publication_attestation_signing_key",
      actorId: params.revokedBy,
      payload: {
        kind: "PUBLICATION_SIGNING_KEY_REVOKED",
        entityRef: key.entity_ref,
        keyId: key.key_id,
        reason: params.reason ?? null,
      },
    });
    return true;
  });
}
