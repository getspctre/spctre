import { createHash } from "node:crypto";
import { sql } from "@/lib/db";

export interface GrcDeliveryDestination {
  id: string;
  kind: "webhook";
  endpoint: string;
  label: string;
  enabled: boolean;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listGrcDeliveryDestinations(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<GrcDeliveryDestination[]> {
  if (!sql) return [];
  const rows = await sql<
    {
      id: string;
      kind: GrcDeliveryDestination["kind"];
      endpoint: string;
      label: string;
      enabled: boolean;
      credential_hash: string | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    SELECT id, kind, endpoint, label, enabled, credential_hash, created_at, updated_at
    FROM grc_delivery_destination WHERE tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
    ORDER BY created_at DESC`;
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    endpoint: row.endpoint,
    label: row.label,
    enabled: row.enabled,
    hasCredential: Boolean(row.credential_hash),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function createGrcDeliveryDestination(params: {
  tenantId: string;
  workspaceId: string;
  kind: GrcDeliveryDestination["kind"];
  endpoint: string;
  label: string;
  credential?: string;
  createdBy: string;
}) {
  if (!sql) throw new Error("Database unavailable.");
  const url = new URL(params.endpoint);
  if (url.protocol !== "https:") throw new Error("GRC destination endpoint must use HTTPS.");
  if (url.username || url.password)
    throw new Error("GRC destination endpoint must not embed credentials.");
  const credentialHash = params.credential
    ? createHash("sha256").update(params.credential).digest("hex")
    : null;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO grc_delivery_destination (tenant_id, workspace_id, kind, endpoint, credential_hash, label, created_by)
    VALUES (${params.tenantId}, ${params.workspaceId}, ${params.kind}, ${url.toString()}, ${credentialHash}, ${params.label}, ${params.createdBy}) RETURNING id`;
  return row.id;
}

export async function updateGrcDeliveryDestination(params: {
  tenantId: string;
  workspaceId: string;
  id: string;
  enabled?: boolean;
  credential?: string;
}) {
  if (!sql) throw new Error("Database unavailable.");
  const credentialHash = params.credential
    ? createHash("sha256").update(params.credential).digest("hex")
    : undefined;
  const rows = await sql<{ id: string }[]>`
    UPDATE grc_delivery_destination SET
      enabled = COALESCE(${params.enabled ?? null}, enabled),
      credential_hash = COALESCE(${credentialHash ?? null}, credential_hash), updated_at = now()
    WHERE id = ${params.id} AND tenant_id = ${params.tenantId} AND workspace_id = ${params.workspaceId}
    RETURNING id`;
  return rows[0]?.id ?? null;
}
