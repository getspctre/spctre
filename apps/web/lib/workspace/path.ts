export function buildWorkspacePath(workspaceSlug: string, path = "/"): string {
  if (!path || path === "/") return `/${workspaceSlug}`;
  return `/${workspaceSlug}${path.startsWith("/") ? path : `/${path}`}`;
}
