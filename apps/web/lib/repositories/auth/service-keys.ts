import { sql } from "@/lib/db";

export interface ApiServiceKeySummary {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export async function revokeServiceTokenAndRefresh(tokenId: string): Promise<"ok" | "db-unavailable"> {
  if (!sql || !tokenId) {
    return "db-unavailable";
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE service_token SET revoked_at = now()
      WHERE id = ${tokenId} AND revoked_at IS NULL
    `;

    await tx`
      UPDATE service_refresh_token SET revoked_at = now()
      WHERE access_token_id = ${tokenId}
        AND revoked_at IS NULL
        AND rotated_at IS NULL
    `;
  });

  return "ok";
}

export async function listActiveApiKeys(
  tenantId: string,
  workspaceId: string
): Promise<ApiServiceKeySummary[] | null> {
  if (!sql) return null;

  const rows = await sql<{
    id: string;
    label: string;
    token_prefix: string;
    scopes: string[];
    expires_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
    created_by: string | null;
  }[]>`
    SELECT id, label, token_prefix, scopes, expires_at, last_used_at, created_at, created_by
    FROM service_token
    WHERE tenant_id = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND key_type = 'API_KEY'
      AND revoked_at IS NULL
    ORDER BY created_at DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  }));
}

export async function revokeApiKey(params: {
  keyId: string;
  tenantId: string;
  workspaceId: string;
}): Promise<boolean | null> {
  if (!sql) return null;
  if (!params.keyId) return false;

  const rows = await sql<{ id: string }[]>`
    UPDATE service_token
    SET revoked_at = now()
    WHERE id = ${params.keyId}
      AND tenant_id = ${params.tenantId}
      AND workspace_id = ${params.workspaceId}
      AND key_type = 'API_KEY'
      AND revoked_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}
