export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
}

export interface WorkspaceContext {
  tenantId: string;
  tenantSlug: string;
  tenantDefaultLocale?: string | null;
  principalPreferredLocale?: string | null;
  tenants: TenantSummary[];
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  workspaces: WorkspaceSummary[];
  needsCookieNormalization: boolean;
}
