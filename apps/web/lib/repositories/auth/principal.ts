import { createHash } from "crypto";
import { sql, rawSql, runWithTenantContext } from "@/lib/db";

export async function findUserPrincipalIdByIdentifier(params: {
  tenantId: string;
  identifier: string;
}): Promise<string | null> {
  if (!sql || !params.identifier.trim()) return null;

  // app_principal is RLS-gated; login/SSO resolves the identifier within a
  // trusted tenant before a session/tenant context exists, so bind it here.
  return runWithTenantContext(params.tenantId, async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM app_principal
      WHERE tenant_id = ${params.tenantId}
        AND principal_type = 'USER'
        AND (
          subject = ${params.identifier}
          OR lower(email) = lower(${params.identifier})
        )
      LIMIT 1
    `;

    return rows[0]?.id ?? null;
  });
}

export async function getPrincipalSubject(params: {
  tenantId: string;
  principalId: string;
}): Promise<string | null> {
  if (!sql) return null;

  // app_principal is RLS-gated; passkey login reads this before a session/tenant
  // context exists, so scope the lookup to the trusted tenant.
  return runWithTenantContext(params.tenantId, async () => {
    const rows = await sql<{ subject: string }[]>`
      SELECT subject
      FROM app_principal
      WHERE id = ${params.principalId}
        AND tenant_id = ${params.tenantId}
      LIMIT 1
    `;

    return rows[0]?.subject ?? null;
  });
}

/** @eeBoundary consumed by ee/web/saml via ee-adapters (knip ignores ee/) */
export async function upsertSamlPrincipal(params: {
  tenantId: string;
  subject: string;
  displayName: string;
  email: string | null;
}): Promise<string | null> {
  if (!sql) return null;

  // app_principal is RLS-gated and the SAML callback runs before a tenant is
  // bound; scope the upsert to the trusted tenant from the validated assertion.
  return runWithTenantContext(params.tenantId, async () => {
    const existing = await sql<{ id: string }[]>`
      SELECT id
      FROM app_principal
      WHERE tenant_id = ${params.tenantId}
        AND subject = ${params.subject}
      LIMIT 1
    `;

    if (existing.length) {
      const principalId = existing[0].id;
      await sql`
        UPDATE app_principal
        SET display_name = ${params.displayName},
            email = ${params.email},
            auth_method = 'SAML',
            last_idp_sync_at = now()
        WHERE id = ${principalId}
          AND tenant_id = ${params.tenantId}
      `;
      return principalId;
    }

    const inserted = await sql<{ id: string }[]>`
      INSERT INTO app_principal (tenant_id, subject, display_name, email, principal_type, auth_method, last_idp_sync_at)
      VALUES (${params.tenantId}, ${params.subject}, ${params.displayName}, ${params.email}, 'USER', 'SAML', now())
      RETURNING id
    `;

    return inserted[0]?.id ?? null;
  });
}

export async function upsertOidcPrincipal(params: {
  tenantId: string;
  subject: string;
  displayName: string;
  email: string | null;
}): Promise<string | null> {
  if (!sql) return null;

  // app_principal is RLS-gated and OIDC callback runs before a tenant is bound;
  // scope the upsert to the trusted tenant from the validated IdP claims.
  return runWithTenantContext(params.tenantId, async () => {
    const existing = await sql<{ id: string }[]>`
      SELECT id
      FROM app_principal
      WHERE tenant_id = ${params.tenantId}
        AND subject = ${params.subject}
      LIMIT 1
    `;

    if (existing.length) {
      const principalId = existing[0].id;
      await sql`
        UPDATE app_principal
        SET display_name = ${params.displayName},
            email = ${params.email},
            auth_method = 'OIDC',
            last_idp_sync_at = now()
        WHERE id = ${principalId}
          AND tenant_id = ${params.tenantId}
      `;
      return principalId;
    }

    const inserted = await sql<{ id: string }[]>`
      INSERT INTO app_principal (tenant_id, subject, display_name, email, principal_type, auth_method, last_idp_sync_at)
      VALUES (${params.tenantId}, ${params.subject}, ${params.displayName}, ${params.email}, 'USER', 'OIDC', now())
      RETURNING id
    `;

    return inserted[0]?.id ?? null;
  });
}

export async function upsertPrincipalExternalIdentity(params: {
  principalId: string;
  tenantId: string;
  providerId: string;
  externalSubject: string;
  externalEmail: string | null;
  issuer: string;
}): Promise<"ok" | "db-unavailable"> {
  if (!sql) return "db-unavailable";

  // principal_external_identity is RLS-gated; bind the trusted tenant so the
  // OIDC callback can record the link before a session/tenant context exists.
  return runWithTenantContext<"ok" | "db-unavailable">(params.tenantId, async () => {
    await sql`
      INSERT INTO principal_external_identity (
        principal_id,
        tenant_id,
        provider_id,
        external_subject,
        external_email,
        last_authenticated_at,
        metadata
      ) VALUES (
        ${params.principalId},
        ${params.tenantId},
        ${params.providerId},
        ${params.externalSubject},
        ${params.externalEmail},
        now(),
        ${sql.json({ issuer: params.issuer })}::jsonb
      )
      ON CONFLICT (provider_id, external_subject) DO UPDATE SET
        principal_id = EXCLUDED.principal_id,
        tenant_id = EXCLUDED.tenant_id,
        external_email = EXCLUDED.external_email,
        last_authenticated_at = now(),
        metadata = EXCLUDED.metadata
    `;

    return "ok";
  });
}

export async function upsertLocalDevPrincipal(params: {
  tenantId: string;
  email: string;
  displayName: string;
}): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app_principal (
      tenant_id, subject, display_name, email, principal_type, auth_method,
      org_role, invite_status, invite_accepted_at
    ) VALUES (
      ${params.tenantId}, ${params.email}, ${params.displayName}, ${params.email}, 'USER', 'LOCAL_DEV',
      'OWNER', 'ACCEPTED', now()
    )
    ON CONFLICT (tenant_id, subject)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      org_role = EXCLUDED.org_role,
      invite_status = 'ACCEPTED',
      disabled_at = null
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

export async function upsertSocialPrincipal(params: {
  provider: "GOOGLE" | "GITHUB";
  subject: string;
  email: string;
  displayName: string;
}): Promise<{ principalId: string; tenantId: string; workspaceId: string } | null> {
  if (!rawSql) return null;

  const externalSubject = `${params.provider.toLowerCase()}:${params.subject}`;

  // 1. Check principal_external_identity association first
  const existingExt = await rawSql<{ principal_id: string; tenant_id: string }[]>`
    SELECT principal_id, tenant_id
    FROM principal_external_identity
    WHERE external_subject = ${externalSubject}
      AND provider_id IS NULL
    LIMIT 1
  `;
  if (existingExt[0]) {
    const { principal_id: principalId, tenant_id: tenantId } = existingExt[0];
    const wsRows = await rawSql<{ id: string }[]>`
      SELECT id FROM workspace WHERE tenant_id = ${tenantId} ORDER BY created_at ASC LIMIT 1
    `;
    return { principalId, tenantId, workspaceId: wsRows[0]?.id ?? "" };
  }

  // 2. Check app_principal by subject (e.g. legacy social signin)
  const existingSubject = await rawSql<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id
    FROM app_principal
    WHERE subject = ${externalSubject}
      AND disabled_at IS NULL
    LIMIT 1
  `;
  if (existingSubject[0]) {
    const { id: principalId, tenant_id: tenantId } = existingSubject[0];
    const wsRows = await rawSql<{ id: string }[]>`
      SELECT id FROM workspace WHERE tenant_id = ${tenantId} ORDER BY created_at ASC LIMIT 1
    `;
    return { principalId, tenantId, workspaceId: wsRows[0]?.id ?? "" };
  }

  // 3. Check app_principal by email match (auto-link)
  const existingEmail = await rawSql<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id
    FROM app_principal
    WHERE lower(email) = lower(${params.email.trim()})
      AND principal_type = 'USER'
      AND disabled_at IS NULL
      AND invite_status <> 'REVOKED'
    ORDER BY created_at ASC
    LIMIT 1
  `;
  if (existingEmail[0]) {
    const { id: principalId, tenant_id: tenantId } = existingEmail[0];
    // Create the link association
    await rawSql`
      INSERT INTO principal_external_identity (
        principal_id, tenant_id, provider_id, external_subject, external_email, last_authenticated_at, metadata
      ) VALUES (
        ${principalId}, ${tenantId}, NULL, ${externalSubject}, ${params.email}, now(), ${sql.json({ provider: params.provider })}::jsonb
      )
      ON CONFLICT (tenant_id, principal_id, external_subject) DO UPDATE SET
        external_email = EXCLUDED.external_email,
        last_authenticated_at = now()
    `;
    const wsRows = await rawSql<{ id: string }[]>`
      SELECT id FROM workspace WHERE tenant_id = ${tenantId} ORDER BY created_at ASC LIMIT 1
    `;
    return { principalId, tenantId, workspaceId: wsRows[0]?.id ?? "" };
  }

  const slugified =
    params.email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) ?? "user";

  const emailHash = createHash("sha256").update(params.email).digest("hex").slice(0, 8);
  const providerPrefix = params.provider.toLowerCase();
  const tenantSlug = `${providerPrefix}-${slugified}-${emailHash}`;
  const workspaceSlug = `workspace-${providerPrefix}`;
  const principalSubject = `${providerPrefix}:${params.subject}`;

  const tenantRows = await rawSql<{ id: string }[]>`
    INSERT INTO tenant (slug, name)
    VALUES (${tenantSlug}, ${`${params.displayName} Organization`})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) return null;

  const workspaceRows = await rawSql<{ id: string }[]>`
    INSERT INTO workspace (tenant_id, slug, name)
    VALUES (${tenantId}, ${workspaceSlug}, ${`${params.displayName} Workspace`})
    ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const workspaceId = workspaceRows[0]?.id;
  if (!workspaceId) return null;

  const principalRows = await rawSql<{ id: string }[]>`
    INSERT INTO app_principal (
      tenant_id, subject, display_name, email, principal_type, auth_method,
      org_role, invite_status, invite_accepted_at, last_idp_sync_at
    ) VALUES (
      ${tenantId}, ${principalSubject}, ${params.displayName}, ${params.email},
      'USER', ${params.provider}, 'OWNER', 'ACCEPTED', now(), now()
    )
    ON CONFLICT (tenant_id, subject)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      auth_method = EXCLUDED.auth_method,
      last_idp_sync_at = now()
    RETURNING id
  `;
  const principalId = principalRows[0]?.id;
  if (!principalId) return null;

  return { principalId, tenantId, workspaceId };
}

export async function linkSocialIdentity(params: {
  principalId: string;
  tenantId: string;
  provider: "GOOGLE" | "GITHUB";
  providerSubject: string;
  providerEmail: string;
}): Promise<void> {
  if (!rawSql) return;
  const externalSubject = `${params.provider.toLowerCase()}:${params.providerSubject}`;
  await rawSql`
    INSERT INTO principal_external_identity (
      principal_id,
      tenant_id,
      provider_id,
      external_subject,
      external_email,
      last_authenticated_at,
      metadata
    ) VALUES (
      ${params.principalId},
      ${params.tenantId},
      NULL,
      ${externalSubject},
      ${params.providerEmail},
      now(),
      ${sql.json({ provider: params.provider })}::jsonb
    )
    ON CONFLICT (tenant_id, principal_id, external_subject) DO UPDATE SET
      external_email = EXCLUDED.external_email,
      last_authenticated_at = now()
  `;
}

export async function unlinkSocialIdentity(params: {
  principalId: string;
  tenantId: string;
  provider: "GOOGLE" | "GITHUB";
}): Promise<void> {
  if (!rawSql) return;
  const prefix = `${params.provider.toLowerCase()}:%`;
  await rawSql`
    DELETE FROM principal_external_identity
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND provider_id IS NULL
      AND external_subject LIKE ${prefix}
  `;
}

export async function listLinkedSocialIdentities(params: {
  principalId: string;
  tenantId: string;
}): Promise<{ provider: "GOOGLE" | "GITHUB"; externalEmail: string | null }[]> {
  if (!rawSql) return [];
  const rows = await rawSql<{ external_subject: string; external_email: string | null }[]>`
    SELECT external_subject, external_email
    FROM principal_external_identity
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND provider_id IS NULL
  `;
  return rows
    .map((row) => {
      const parts = row.external_subject.split(":");
      const provider = parts[0]?.toUpperCase();
      if (provider === "GOOGLE" || provider === "GITHUB") {
        return { provider: provider as "GOOGLE" | "GITHUB", externalEmail: row.external_email };
      }
      return null;
    })
    .filter(
      (v): v is { provider: "GOOGLE" | "GITHUB"; externalEmail: string | null } => v !== null,
    );
}

function slugifyLocalDev(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

export async function ensureLocalDevTenantWorkspace(params: {
  email: string;
  displayName: string;
}): Promise<{ tenantId: string; workspaceId: string } | null> {
  if (!sql) return null;

  const localPart = params.email.split("@")[0] || "user";
  const baseSlug = slugifyLocalDev(localPart) || "user";
  const emailHash = createHash("sha256").update(params.email).digest("hex").slice(0, 8);
  const tenantSlug = `local-${baseSlug}-${emailHash}`;
  const workspaceSlug = "workspace-local";

  const tenantRows = await sql<{ id: string }[]>`
    INSERT INTO tenant (slug, name)
    VALUES (${tenantSlug}, ${`${params.displayName} Organization`})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) return null;

  const workspaceRows = await sql<{ id: string }[]>`
    INSERT INTO workspace (tenant_id, slug, name)
    VALUES (${tenantId}, ${workspaceSlug}, ${`${params.displayName} Workspace`})
    ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const workspaceId = workspaceRows[0]?.id;
  if (!workspaceId) return null;

  return { tenantId, workspaceId };
}
