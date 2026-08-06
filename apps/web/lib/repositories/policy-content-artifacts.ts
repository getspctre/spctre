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
