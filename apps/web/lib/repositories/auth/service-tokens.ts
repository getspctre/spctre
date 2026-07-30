import { createHash, randomBytes } from "crypto";
import { rawSql, sql, type TxClient } from "@/lib/db";

export type ServiceTokenScope =
  | "bundle:read"
  | "decision:evaluate"
  | "evidence:write"
  | "heartbeat:write"
  | "policy:import"
  | "compliance:read"
  | "simulation:run"
  | "approvals:read"
  | "operations:read"
  | "workflow:read"
  | "members:read"
  | "workspaces:read"
  | "e2e:write";

// Runtime agent tokens (issued by `spctre init`) get only these scopes. They
// deliberately exclude policy:import so a runtime agent can never author,
// import, approve, or publish its own governing policy.
export const DEV_TOKEN_SCOPES: ServiceTokenScope[] = ["bundle:read", "decision:evaluate", "evidence:write", "heartbeat:write"];
export const ALL_API_KEY_SCOPES: ServiceTokenScope[] = [
  ...DEV_TOKEN_SCOPES,
  "policy:import",
  "compliance:read",
  "simulation:run",
  "approvals:read",
  "operations:read",
  "workflow:read",
  "members:read",
  "workspaces:read",
  "e2e:write",
];
export const ADMIN_ISSUABLE_API_KEY_SCOPES: ServiceTokenScope[] = ALL_API_KEY_SCOPES.filter(
  (scope) => scope !== "e2e:write"
);

export interface ServiceTokenAuth {
  tokenId: string;
  tenantId: string;
  workspaceId: string;
  principalId: string;
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
  requiredScope: ServiceTokenScope
): Promise<{ ok: true; auth: ServiceTokenAuth } | { ok: false; error: string }> {
  if (!sql) return { ok: false, error: "Database not configured." };

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) return { ok: false, error: "Missing bearer token." };

  const rows = await sql<
    {
      id: string;
      tenant_id: string;
      workspace_id: string;
      principal_id: string;
      scopes: string[];
    }[]
  >`
    SELECT id, tenant_id, workspace_id, principal_id, scopes
    FROM service_token
    WHERE token_hash = ${hashServiceToken(bearer)}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return { ok: false, error: "Missing or invalid bearer token." };

  const scopes = (row.scopes ?? []) as ServiceTokenScope[];
  if (!scopes.includes(requiredScope)) {
    return { ok: false, error: `Token is missing ${requiredScope} scope.` };
  }

  await sql`
    UPDATE service_token
    SET last_used_at = now()
    WHERE id = ${row.id}
  `;

  return {
    ok: true,
    auth: {
      tokenId: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      principalId: row.principal_id,
      scopes
    }
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
    environment: string;
  }
): Promise<TokenPair> {
  const rawAccess = createRawServiceToken();
  const rawRefresh = createRawRefreshToken();
  const accessHash = hashServiceToken(rawAccess);
  const refreshHash = hashServiceToken(rawRefresh);

  const accessExpiresAt = new Date(
    Date.now() + ACCESS_TOKEN_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();
  const refreshExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const tokenRows = await tx<{ id: string }[]>`
    INSERT INTO service_token (
      tenant_id, workspace_id, principal_id, label,
      token_hash, token_prefix, scopes, expires_at
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
      ${params.label}, ${accessHash}, ${rawAccess.slice(0, 16)},
      ${params.scopes}::text[], ${accessExpiresAt}
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
  rawRefreshToken: string
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
      console.error(JSON.stringify({ event: "token.revoked_reuse_attempt", token_id: row.id, tenant_id: row.tenant_id, revoked_at: row.revoked_at, ts: new Date().toISOString() }));
      return { ok: false as const, error: "Refresh token has been revoked.", status: 401 };
    }
    if (row.rotated_at) {
      console.error(JSON.stringify({ event: "token.rotated_reuse_attempt", token_id: row.id, tenant_id: row.tenant_id, rotated_at: row.rotated_at, ts: new Date().toISOString() }));
      return { ok: false as const, error: "Refresh token has already been rotated.", status: 401 };
    }
    if (new Date(row.expires_at) <= new Date()) {
      console.error(JSON.stringify({ event: "token.expired_refresh_attempt", token_id: row.id, tenant_id: row.tenant_id, expired_at: row.expires_at, ts: new Date().toISOString() }));
      return { ok: false as const, error: "Refresh token expired. Run spctre init to reconnect.", status: 401 };
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
  expiresInDays?: number;
}): Promise<ServiceAccountKeyResult> {
  if (!sql) throw new Error("Database not configured.");

  const rawToken = `${SERVICE_ACCOUNT_TOKEN_PREFIX}_${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashServiceToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const rows = await sql<{ id: string }[]>`
    INSERT INTO service_token (
      tenant_id, workspace_id, principal_id, label,
      token_hash, token_prefix, scopes, expires_at, key_type, created_by
    ) VALUES (
      ${params.tenantId}, ${params.workspaceId}, ${params.principalId},
      ${params.label}, ${tokenHash}, ${tokenPrefix},
      ${params.scopes}::text[], ${expiresAt ?? null},
      'API_KEY', ${params.createdBy}
    )
    RETURNING id
  `;

  return {
    rawToken,
    tokenId: rows[0].id,
    tokenPrefix,
    expiresAt,
    scopes: params.scopes,
  };
}
