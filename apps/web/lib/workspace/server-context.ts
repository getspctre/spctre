import { cookies } from "next/headers";
import { getAuthSession } from "../auth-session";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "../demo";
import {
  isDatabaseConfigured,
  listTenantsForWorkspaceContext,
  listWorkspacesForWorkspaceContext,
} from "./repository";
import { ACTIVE_TENANT_COOKIE, ACTIVE_WORKSPACE_COOKIE } from "./cookies";
import type { WorkspaceContext, WorkspaceSummary } from "./types";
import {
  getLocalePreferencesForShell,
  type LocalePreferences,
} from "@/lib/repositories/i18n/preferences";
import { swallow } from "@/lib/platform/swallow";

interface WorkspaceContextOptions {
  workspaceSlug?: string;
}

/**
 * Resolves the active workspace and tenant from the current request cookies/session.
 *
 * NOTE: This function does NOT enforce authentication. When there is no valid session
 * it falls back to the cookie-supplied tenant ID (or the demo tenant). API route
 * handlers must check `getAuthSession()` independently before calling this function.
 * Use this only in Server Components and Server Actions where the auth boundary is
 * already enforced upstream (e.g. a layout that redirects unauthenticated users).
 */

function demoFallbackContext(
  options: WorkspaceContextOptions,
  cookieWorkspaceId: string | undefined,
  cookieTenantId: string | undefined,
): WorkspaceContext {
  const fallbackSlug = options.workspaceSlug ?? "workspace-demo";

  return {
    tenantId: DEMO_TENANT_ID,
    tenantSlug: "tenant-demo",
    tenantDefaultLocale: null,
    principalPreferredLocale: null,
    tenants: [{ id: DEMO_TENANT_ID, slug: "tenant-demo", name: "Demo Organization" }],
    workspaceId: DEMO_WORKSPACE_ID,
    workspaceSlug: fallbackSlug,
    workspaceName: "Default Workspace",
    needsCookieNormalization:
      cookieWorkspaceId !== DEMO_WORKSPACE_ID ||
      cookieTenantId !== DEMO_TENANT_ID ||
      fallbackSlug !== "workspace-demo",
    workspaces: [{ id: DEMO_WORKSPACE_ID, slug: fallbackSlug, name: "Default Workspace" }],
  };
}

function resolveActiveTenant(
  tenantOptions: WorkspaceContext["tenants"],
  isDemo: boolean,
  sessionTenantId: string | undefined,
  cookieTenantId: string | undefined,
) {
  if (isDemo) {
    return tenantOptions.find((tenant) => tenant.id === DEMO_TENANT_ID) ?? tenantOptions[0];
  }
  return (
    tenantOptions.find((tenant) => tenant.id === sessionTenantId) ??
    tenantOptions.find((tenant) => tenant.id === cookieTenantId) ??
    tenantOptions.find((tenant) => tenant.id === DEMO_TENANT_ID) ??
    tenantOptions[0]
  );
}

function resolveActiveWorkspace(
  workspaceOptions: WorkspaceSummary[],
  isDemo: boolean,
  workspaceSlug: string | undefined,
  cookieWorkspaceId: string | undefined,
  fallbackWorkspace: WorkspaceSummary,
) {
  if (isDemo) {
    return workspaceOptions.find((w) => w.id === DEMO_WORKSPACE_ID) ?? fallbackWorkspace;
  }
  const activeFromSlug = workspaceSlug
    ? workspaceOptions.find((workspace) => workspace.slug === workspaceSlug)
    : undefined;
  return (
    activeFromSlug ??
    workspaceOptions.find((workspace) => workspace.id === cookieWorkspaceId) ??
    workspaceOptions[0]
  );
}

export async function getWorkspaceContext(
  options: WorkspaceContextOptions = {},
): Promise<WorkspaceContext> {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const cookieTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
  const session = await getAuthSession().catch(swallow("getAuthSession", null));

  if (!isDatabaseConfigured()) {
    return demoFallbackContext(options, cookieWorkspaceId, cookieTenantId);
  }

  const tenantRows = await listTenantsForWorkspaceContext({
    principalSubject: session?.subject,
    fallbackTenantId: cookieTenantId ?? DEMO_TENANT_ID,
  });
  const tenantOptions = tenantRows.length
    ? tenantRows
    : [{ id: DEMO_TENANT_ID, slug: "tenant-demo", name: "Demo Organization" }];

  const isDemo =
    options.workspaceSlug === "workspace-demo" ||
    (!options.workspaceSlug && cookieWorkspaceId === DEMO_WORKSPACE_ID);

  if (isDemo && !tenantOptions.some((tenant) => tenant.id === DEMO_TENANT_ID)) {
    tenantOptions.unshift({ id: DEMO_TENANT_ID, slug: "tenant-demo", name: "Demo Organization" });
  }

  const activeTenant = resolveActiveTenant(
    tenantOptions,
    isDemo,
    session?.tenantId,
    cookieTenantId,
  );

  const workspaceRows = await listWorkspacesForWorkspaceContext(
    activeTenant.id,
    session?.principalId,
  );

  const fallbackWorkspace: WorkspaceSummary = {
    id: DEMO_WORKSPACE_ID,
    slug: "workspace-demo",
    name: "Default Workspace",
  };

  const workspaceOptions = workspaceRows.length ? workspaceRows : [fallbackWorkspace];
  const activeWorkspace = resolveActiveWorkspace(
    workspaceOptions,
    isDemo,
    options.workspaceSlug,
    cookieWorkspaceId,
    fallbackWorkspace,
  );
  const needsCookieNormalization =
    activeWorkspace.id !== cookieWorkspaceId || activeTenant.id !== cookieTenantId;
  const localePreferences: LocalePreferences = await getLocalePreferencesForShell({
    tenantId: activeTenant.id,
    principalId: session?.principalId,
  }).catch(swallow("getLocalePreferencesForShell", {}));

  return {
    tenantId: activeTenant.id,
    tenantSlug: activeTenant.slug,
    tenantDefaultLocale: localePreferences.tenantDefaultLocale,
    principalPreferredLocale: localePreferences.principalPreferredLocale,
    tenants: tenantOptions,
    workspaceId: activeWorkspace.id,
    workspaceSlug: activeWorkspace.slug,
    workspaceName: activeWorkspace.name,
    workspaces: workspaceOptions,
    needsCookieNormalization,
  };
}

export async function getRequiredWorkspaceContext(): Promise<{
  workspaceId: string;
  tenantId: string;
}> {
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const cookieTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;

  if (isDatabaseConfigured()) {
    if (!cookieWorkspaceId || !cookieTenantId) {
      throw new Error("Active workspace or tenant context is required. Please select a workspace.");
    }
  }

  const context = await getWorkspaceContext();
  return { workspaceId: context.workspaceId, tenantId: context.tenantId };
}
