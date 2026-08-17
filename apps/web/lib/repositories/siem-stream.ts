import type { JSONValue } from "postgres";
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
  consecutiveFailures: number;
  lastError: string | null;
  lastFailureAt: Date | null;
  /** Set only when the forwarder disabled the stream, never by an operator. */
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSiemStreams(
  tenantId: string,
  workspaceId: string,
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
      consecutive_failures AS "consecutiveFailures",
      last_error        AS "lastError",
      last_failure_at   AS "lastFailureAt",
      suspended_at      AS "suspendedAt",
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
  credentialKey: string,
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
      ${sql.json(config as JSONValue)},
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
  id: string,
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
  enabled: boolean,
): Promise<boolean> {
  if (!sql) return false;
  // Re-enabling is the operator's resume: the forwarder suspends a stream by
  // disabling it, so clearing the failure state here is what lets delivery
  // start again. The cursor is deliberately untouched, so it resumes from the
  // last acknowledged event and no evidence is skipped.
  const result = await sql`
    UPDATE workspace_siem_stream
    SET enabled              = ${enabled},
        consecutive_failures = ${enabled ? 0 : sql`consecutive_failures`},
        last_error           = ${enabled ? null : sql`last_error`},
        last_failure_at      = ${enabled ? null : sql`last_failure_at`},
        suspended_at         = ${enabled ? null : sql`suspended_at`},
        updated_at           = now()
    WHERE tenant_id    = ${tenantId}
      AND workspace_id = ${workspaceId}
      AND id           = ${id}
  `;
  return result.count > 0;
}
