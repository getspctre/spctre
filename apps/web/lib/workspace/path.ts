export function buildWorkspacePath(workspaceSlug: string, path = "/"): string {
  if (!path || path === "/") return `/${workspaceSlug}`;
  return `/${workspaceSlug}${path.startsWith("/") ? path : `/${path}`}`;
}

const WORKSPACE_SCOPED_ROOT_SEGMENTS = new Set([
  "agents",
  "author",
  "blueprints",
  "compliance",
  "escalation-routing",
  "escalations",
  "evidence",
  "onboarding",
  "operations",
  "packs",
  "review",
  "rules",
  "siem-export",
  "simulate",
  "usage-billing",
]);

/**
 * Keeps a workspace switch on the equivalent scoped route when possible.
 * Global routes (such as /admin) intentionally go to the selected workspace's
 * policy home because they do not have a workspace-scoped counterpart.
 */
export function buildWorkspaceSwitchPath(params: {
  workspaceSlug: string;
  pathname: string;
  search: string;
  knownWorkspaceSlugs: string[];
}): string {
  const segments = params.pathname.split("/").filter(Boolean);
  const currentPathIsWorkspaceScoped = params.knownWorkspaceSlugs.includes(segments[0] ?? "");
  const barePathIsWorkspaceScoped =
    !segments.length || WORKSPACE_SCOPED_ROOT_SEGMENTS.has(segments[0] ?? "");
  const path = currentPathIsWorkspaceScoped
    ? `/${segments.slice(1).join("/")}`
    : barePathIsWorkspaceScoped
      ? params.pathname
      : "/";
  const query = params.search ? `?${params.search}` : "";
  return `${buildWorkspacePath(params.workspaceSlug, path)}${query}`;
}
