import { sql } from "@/lib/db";

export interface SiemStream {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  type: "SPLUNK_HEC" | "SENTINEL";
  enabled: boolean;
  url: string;
  config: Record<string, unknown>;
  hasCredentials: boolean;
  lastForwardedAt: Date | null;
  lastForwardedId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSiemStreams(
  tenantId: string,
  workspaceId: string
): Promise<SiemStream[]> {
  if (!sql) return [];
  return sql<SiemStream[]>`
    SELECT
      id,
      tenant_id        AS "tenantId",
      workspace_id     AS "workspaceId",
      name,
      type,
      enabled,
      url,
      config,
      (credentials_encrypted IS NOT NULL) AS "hasCredentials",
      last_forwarded_at AS "lastForwardedAt",
      last_forwarded_id AS "lastForwardedId",
      created_at       AS "createdAt",
      updated_at       AS "updatedAt"
    FROM workspace_siem_stream
    WHERE tenant_id    = ${tenantId}
      AND workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
}

export async function createSiemStream(
  tenantId: string,
  workspaceId: string,
  name: string,
  type: "SPLUNK_HEC" | "SENTINEL",
  url: string,
  config: Record<string, unknown>,
  credentialsJson: string,
  credentialKey: string
): Promise<SiemStream | null> {
  if (!sql) return null;
  const rows = await sql<SiemStream[]>`
    INSERT INTO workspace_siem_stream (
      tenant_id, workspace_id, name, type, url, config, credentials_encrypted
    ) VALUES (
      ${tenantId},
      ${workspaceId},
      ${name},
      ${type},
      ${url},
      ${JSON.stringify(config)},
      pgp_sym_encrypt(${credentialsJson}, ${credentialKey})
    )
    RETURNING
      id,
      tenant_id        AS "tenantId",
      workspace_id     AS "workspaceId",
      name,
      type,
      enabled,
      url,
      config,
      (credentials_encrypted IS NOT NULL) AS "hasCredentials",
      last_forwarded_at AS "lastForwardedAt",
      last_forwarded_id AS "lastForwardedId",
      created_at       AS "createdAt",
      updated_at       AS "updatedAt"
  `;
  return rows[0] ?? null;
}

export async function deleteSiemStream(
  tenantId: string,
  workspaceId: string,
  id: string
): Promise<boolean> {
  if (!sql) return false;
  const result = await sql`
    DELETE FROM workspace_siem_stream
    WHERE tenant_id    = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND id           = ${id}
  `;
  return result.count > 0;
}

export async function toggleSiemStream(
  tenantId: string,
  workspaceId: string,
  id: string,
  enabled: boolean
): Promise<boolean> {
  if (!sql) return false;
  const result = await sql`
    UPDATE workspace_siem_stream
    SET enabled    = ${enabled},
        updated_at = now()
    WHERE tenant_id    = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND id           = ${id}
  `;
  return result.count > 0;
}
