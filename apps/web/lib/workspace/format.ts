import type { WorkspaceContext } from "./types";

export function formatWorkspaceEyebrow(context: WorkspaceContext): string {
  return `${context.tenantSlug} / ${context.workspaceSlug}`;
}

export function formatGovernancePath(context: WorkspaceContext, surface: string): string {
  return `${context.tenantSlug} → ${context.workspaceSlug} → ${surface}`;
}
