import { createHash } from "crypto";
import { sql } from "@/lib/db";

export const MAX_POLICY_CONTENT_ARTIFACT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["application/yaml", "text/yaml", "application/json"]);

function encryptionKey(): string {
  const key = process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set.");
  return key;
}

export function policyContentHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function retainPolicyContentArtifact(params: {
  contentHash: string;
  bytes: Uint8Array;
  mediaType: string;
  tenantId: string;
  workspaceId: string;
  tokenId?: string;
}) {
  if (!sql) throw new Error("Database not configured.");
  if (params.bytes.byteLength > MAX_POLICY_CONTENT_ARTIFACT_BYTES) {
    throw new Error(`Policy artifact exceeds ${MAX_POLICY_CONTENT_ARTIFACT_BYTES} byte limit.`);
  }
  if (!ALLOWED_MEDIA_TYPES.has(params.mediaType)) throw new Error("Unsupported policy artifact media type.");
  if (policyContentHash(params.bytes) !== params.contentHash) throw new Error("Policy artifact content hash mismatch.");
  const key = encryptionKey();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_content_artifact (content_hash, media_type, size_bytes, content_encrypted)
      VALUES (${params.contentHash}, ${params.mediaType}, ${params.bytes.byteLength}, pgp_sym_encrypt_bytea(${Buffer.from(params.bytes)}, ${key}))
      ON CONFLICT (content_hash) DO NOTHING
    `;
    await tx`
      INSERT INTO policy_content_artifact_access_audit (tenant_id, workspace_id, content_hash, token_id, action)
      VALUES (${params.tenantId}, ${params.workspaceId}, ${params.contentHash}, ${params.tokenId ?? null}, 'WRITE')
    `;
  });
}

export async function bindEvidenceToPolicyContentArtifact(params: {
  tenantId: string;
  workspaceId: string;
  decisionId: string;
  revisionId?: string;
  contentHash: string;
}) {
  if (!sql) throw new Error("Database not configured.");
  await sql`
    INSERT INTO runtime_evidence_policy_content_ref (tenant_id, workspace_id, decision_id, revision_id, content_hash)
    VALUES (${params.tenantId}, ${params.workspaceId}, ${params.decisionId}, ${params.revisionId ?? null}, ${params.contentHash})
    ON CONFLICT DO NOTHING
  `;
}

export async function readPolicyContentArtifactForEvidenceToken(params: {
  tenantId: string;
  workspaceId: string;
  tokenId: string;
  connector: string;
  grants: Array<{ revisionId: string; notBefore: string; notAfter?: string }>;
  contentHash: string;
}): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  if (!sql) return null;
  const references = await sql<{ revision_id: string; created_at: Date }[]>`
    SELECT ref.revision_id, evidence.created_at
    FROM runtime_evidence_policy_content_ref ref
    JOIN runtime_evidence_event evidence
      ON evidence.tenant_id = ref.tenant_id
      AND evidence.workspace_id = ref.workspace_id
      AND evidence.decision_id = ref.decision_id
    WHERE ref.tenant_id = ${params.tenantId}
      AND ref.workspace_id = ${params.workspaceId}
      AND ref.content_hash = ${params.contentHash}
      AND evidence.connector = ${params.connector}
  `;
  const authorized = references.some((reference) =>
    params.grants.some((grant) => {
      const at = reference.created_at.getTime();
      return (
        grant.revisionId === reference.revision_id &&
        at >= new Date(grant.notBefore).getTime() &&
        (!grant.notAfter || at < new Date(grant.notAfter).getTime())
      );
    }),
  );
  const key = encryptionKey();
  const rows = authorized
    ? await sql<{ media_type: string; bytes: Buffer }[]>`
        SELECT media_type, pgp_sym_decrypt_bytea(content_encrypted, ${key}) AS bytes
        FROM policy_content_artifact WHERE content_hash = ${params.contentHash} LIMIT 1
      `
    : [];
  const row = rows[0];
  await sql`
    INSERT INTO policy_content_artifact_access_audit (tenant_id, workspace_id, content_hash, token_id, action)
    VALUES (${params.tenantId}, ${params.workspaceId}, ${params.contentHash}, ${params.tokenId}, ${row ? "READ" : "DENIED"})
  `;
  return row ? { bytes: new Uint8Array(row.bytes), mediaType: row.media_type } : null;
}
