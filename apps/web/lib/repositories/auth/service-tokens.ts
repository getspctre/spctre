import { createHash, randomBytes } from "crypto";
import { rawSql, runWithTransientReadRetry, sql, type TxClient } from "@/lib/db";

export type ServiceTokenScope =
  | "bundle:read"
  | "decision:evaluate"
  | "evidence:write"
  | "heartbeat:write"
  | "policy:import"
  | "blueprint:import"
  | "compliance:read"
  | "simulation:run"
  | "approvals:read"
  | "operations:read"
  | "workflow:read"
  | "members:read"
  | "workspaces:read"
  | "e2e:write"
  | "evidence:export";

// Runtime agent tokens (issued by `spctre init`) get only these scopes. They
// deliberately exclude policy:import and blueprint:import so a runtime agent can
// never author, import, approve, or publish its own governing policy or its own
// authority Blueprint.
export const DEV_TOKEN_SCOPES: ServiceTokenScope[] = [
  "bundle:read",
  "decision:evaluate",
  "evidence:write",
  "heartbeat:write",
];
export const ALL_API_KEY_SCOPES: ServiceTokenScope[] = [
  ...DEV_TOKEN_SCOPES,
  "policy:import",
  "blueprint:import",
  "compliance:read",
  "simulation:run",
  "approvals:read",
  "operations:read",
  "workflow:read",
  "members:read",
  "workspaces:read",
  "e2e:write",
  "evidence:export",
];
export const ADMIN_ISSUABLE_API_KEY_SCOPES: ServiceTokenScope[] = ALL_API_KEY_SCOPES.filter(
  (scope) => scope !== "e2e:write",
);

export interface ServiceTokenAuth {
  tokenId: string;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  connector?: string;
  evidenceExportGrants: Array<{ revisionId: string; notBefore: string; notAfter?: string }>;
  scopes: ServiceTokenScope[];
}

export interface TokenPair {
  accessToken: string;
  accessTokenId: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenId: string;
  refreshTokenExpiresAt: string;
}

const ACCESS_TOKEN_PREFIX = "spctre_dev";
const REFRESH_TOKEN_PREFIX = "spctre_ref";
const SERVICE_ACCOUNT_TOKEN_PREFIX = "spctre_svc";

const ACCESS_TOKEN_TTL_HOURS = 1;
const REFRESH_TOKEN_TTL_DAYS = 90;

function hashServiceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createRawServiceToken() {
  return `${ACCESS_TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

function createRawRefreshToken() {
  return `${REFRESH_TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

export async function authenticateServiceToken(
  request: Request,
  requiredScope: ServiceTokenScope,
): Promise<{ ok: true; auth: ServiceTokenAuth } | { ok: false; error: string }> {
  if (!sql) return { ok: false, error: "Database not configured." };
  // Authentication starts without a tenant context. Use the owner connection
  // for the hash lookup, then derive the tenant exclusively from that trusted
  // row. The raw token is unguessable and is never used as a tenant selector.
  // Production requires DATABASE_OWNER_URL to use an RLS-bypassing owner role;
  // without it this fallback cannot see tenant-isolated token rows.
  const db = rawSql ?? sql;

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) return { ok: false, error: "Missing bearer token." };

  const rows = await runWithTransientReadRetry(
    () => db<
      {
        id: string;
        tenant_id: string;
        workspace_id: string;
        principal_id: string;
        connector: string | null;
        scopes: string[];
      }[]
    >`
    SELECT id, tenant_id, workspace_id, principal_id, scopes
    FROM service_token
    WHERE token_hash = ${hashServiceToken(bearer)}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `,
  );

  const row = rows[0];
  if (!row) return { ok: false, error: "Missing or invalid bearer token." };

  const scopes = (row.scopes ?? []) as ServiceTokenScope[];
  if (!scopes.includes(requiredScope)) {
    return { ok: false, error: `Token is missing ${requiredScope} scope.` };
  }

  await db`
    UPDATE service_token
    SET last_used_at = now()
    WHERE id = ${row.id}
  `;

  const grantRows = scopes.includes("evidence:export")
    ? await db<{ revision_id: string; not_before: Date; not_after: Date | null }[]>`
        SELECT revision_id, not_before, not_after
        FROM service_token_evidence_export_grant
        WHERE token_id = ${row.id}
          AND not_before <= now()
          AND (not_after IS NULL OR not_after > now())
      `
    : [];

  return {
    ok: true,
    auth: {
      tokenId: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalId: row.principal_id,
      connector: row.connector ?? undefined,
      evidenceExportGrants: grantRows.map((grant) => ({
        revisionId: grant.revision_id,
        notBefore: grant.not_before.toISOString(),
        notAfter: grant.not_after?.toISOString(),
      })),
      scopes,
    },
  };
}

export function hasBearerToken(request: Request) {
  return (request.headers.get("authorization") ?? "").startsWith("Bearer ");
}

/**
 * Issues a short-lived access token + long-lived refresh token as a pair
 * within an existing transaction (tx).
 */
export async function issueAccessRefreshPair(
  tx: TxClient,
  params: {
    tenantId: string;
    workspaceId: string;
    principalId: string;
    label: string;
    scopes: ServiceTokenScope[];
    connector?: string;
    environment: string;
  },
): Promise<TokenPair> {
  const rawAccess = createRawServiceToken();
  const rawRefresh = createRawRefreshToken();
  const accessHash = hashServiceToken(rawAccess);
  const refreshHash = hashServiceToken(rawRefresh);

  const accessExpiresAt = new Date(
    Date.now() + ACCESS_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const tokenRows = await tx<{ id: string }[]>`
    INSERT INTO service_token (
      tenant_id, workspace_id, principal_id, label,
      token_hash, token_prefix, scopes, connector, expires_at
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
      ${params.label}, ${accessHash}, ${rawAccess.slice(0, 16)},
      ${params.scopes}::text[], ${params.connector ?? null}, ${accessExpiresAt}
    )
    RETURNING id
  `;
  const accessTokenId = tokenRows[0].id;

  const refreshRows = await tx<{ id: string }[]>`
    INSERT INTO service_refresh_token (
      tenant_id, workspace_id, principal_id, access_token_id,
      token_hash, token_prefix, expires_at
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
      ${accessTokenId}, ${refreshHash}, ${rawRefresh.slice(0, 16)},
      ${refreshExpiresAt}
    )
    RETURNING id
  `;

  return {
    accessToken: rawAccess,
    accessTokenId,
    accessTokenExpiresAt: accessExpiresAt,
    refreshToken: rawRefresh,
    refreshTokenId: refreshRows[0].id,
    refreshTokenExpiresAt: refreshExpiresAt,
  };
}

/**
 * Validates a refresh token and rotates it: revokes the old access + refresh
 * tokens, issues a fresh pair.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
): Promise<{ ok: true; pair: TokenPair } | { ok: false; error: string; status: number }> {
  if (!sql) return { ok: false, error: "Database not configured.", status: 503 };
  const db = rawSql ?? sql;

  const tokenHash = hashServiceToken(rawRefreshToken);

  const result = await db.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        tenant_id: string;
        workspace_id: string;
        principal_id: string;
        access_token_id: string;
        expires_at: string;
        revoked_at: string | null;
        rotated_at: string | null;
        scopes: string[] | null;
        label: string | null;
      }[]
    >`
      SELECT
        rt.id,
        rt.tenant_id,
        rt.workspace_id,
        rt.principal_id,
        rt.access_token_id,
        rt.expires_at,
        rt.revoked_at,
        rt.rotated_at,
        st.scopes,
        st.label
      FROM service_refresh_token rt
      LEFT JOIN service_token st ON st.id = rt.access_token_id
      WHERE rt.token_hash = ${tokenHash}
      LIMIT 1
      FOR UPDATE OF rt
    `;

    const row = rows[0];
    if (!row) return { ok: false as const, error: "Refresh token not found.", status: 401 };
    if (row.revoked_at) {
      console.error(
        JSON.stringify({
          event: "token.revoked_reuse_attempt",
          token_id: row.id,
          tenant_id: row.tenant_id,
          revoked_at: row.revoked_at,
          ts: new Date().toISOString(),
        }),
      );
      return { ok: false as const, error: "Refresh token has been revoked.", status: 401 };
    }
    if (row.rotated_at) {
      console.error(
        JSON.stringify({
          event: "token.rotated_reuse_attempt",
          token_id: row.id,
          tenant_id: row.tenant_id,
          rotated_at: row.rotated_at,
          ts: new Date().toISOString(),
        }),
      );
      return { ok: false as const, error: "Refresh token has already been rotated.", status: 401 };
    }
    if (new Date(row.expires_at) <= new Date()) {
      console.error(
        JSON.stringify({
          event: "token.expired_refresh_attempt",
          token_id: row.id,
          tenant_id: row.tenant_id,
          expired_at: row.expires_at,
          ts: new Date().toISOString(),
        }),
      );
      return {
        ok: false as const,
        error: "Refresh token expired. Run spctre init to reconnect.",
        status: 401,
      };
    }

    const scopes = (row.scopes ?? []) as ServiceTokenScope[];
    const label = row.label ?? "Rotated token";

    await tx`
      UPDATE service_token SET revoked_at = now() WHERE id = ${row.access_token_id}
    `;

    const newPair = await issueAccessRefreshPair(tx, {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalId: row.principal_id,
      label,
      scopes,
      environment: "",
    });

    await tx`
      UPDATE service_refresh_token
      SET rotated_at = now(), rotated_into = ${newPair.refreshTokenId}
      WHERE id = ${row.id}
        AND rotated_at IS NULL
        AND revoked_at IS NULL
    `;

    return { ok: true as const, pair: newPair };
  });

  return result;
}

export interface ServiceAccountKeyResult {
  rawToken: string;
  tokenId: string;
  tokenPrefix: string;
  expiresAt: string | null;
  scopes: ServiceTokenScope[];
  connector?: string;
}

export interface EvidenceExportGrantInput {
  revisionId: string;
  notBefore?: string;
  notAfter?: string;
}

/**
 * Issues a long-lived named API key (key_type = 'API_KEY') for CI/CD and
 * service account use. No refresh token is issued — these keys are revoked
 * explicitly through the admin UI or DELETE /api/service-keys/:id.
 *
 * Returns the raw token exactly once; callers must surface it to the user
 * immediately (it cannot be retrieved again).
 */
export async function issueServiceAccountKey(params: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  createdBy: string;
  label: string;
  scopes: ServiceTokenScope[];
  connector?: string;
  evidenceExportGrants?: EvidenceExportGrantInput[];
  expiresInDays?: number;
}): Promise<ServiceAccountKeyResult> {
  if (!sql) throw new Error("Database not configured.");
  if (params.scopes.includes("evidence:export") && !params.connector?.trim()) {
    throw new Error("evidence:export keys require a connector binding.");
  }
  if (params.scopes.includes("evidence:export") && !params.evidenceExportGrants?.length) {
    throw new Error("evidence:export keys require at least one revision grant.");
  }
  if (!params.scopes.includes("evidence:export") && params.evidenceExportGrants?.length) {
    throw new Error("evidence export grants require the evidence:export scope.");
  }

  const rawToken = `${SERVICE_ACCOUNT_TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashServiceToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const rows = await sql.begin(async (tx) => {
    const validGrants = params.evidenceExportGrants ?? [];
    if (validGrants.length) {
      const revisionIds = validGrants.map((grant) => grant.revisionId);
      const revisions = await tx<{ id: string }[]>`
        SELECT id FROM policy_revision
        WHERE tenant_id = ${params.tenantId}
          AND workspace_id = ${params.workspaceId}
          AND id = ANY(${revisionIds}::uuid[])
      `;
      if (revisions.length !== new Set(revisionIds).size) {
        throw new Error("evidence export grants must reference revisions in this workspace.");
      }
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO service_token (
        tenant_id, workspace_id, principal_id, label,
        token_hash, token_prefix, scopes, connector, expires_at, key_type, created_by
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
        ${params.label}, ${tokenHash}, ${tokenPrefix},
        ${params.scopes}::text[], ${params.connector ?? null}, ${expiresAt ?? null},
        'API_KEY', ${params.createdBy}
      )
      RETURNING id
    `;
    for (const grant of validGrants) {
      await tx`
        INSERT INTO service_token_evidence_export_grant (token_id, revision_id, not_before, not_after)
        VALUES (${inserted[0].id}, ${grant.revisionId}, ${grant.notBefore ?? "-infinity"}, ${grant.notAfter ?? null})
      `;
    }
    return inserted;
  });

  return { rawToken, tokenId: rows[0].id, tokenPrefix, expiresAt, scopes: params.scopes };
}
