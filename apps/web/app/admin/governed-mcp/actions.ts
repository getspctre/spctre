"use server";

import { revalidatePath } from "next/cache";
import { findActorById } from "@/lib/actors";
import { getAuthSession } from "@/lib/auth-session";
import { verifyWriteAccess } from "@/lib/demo-guard";
import {
  grantMcpToolCapability,
  registerMcpTool,
  revokeMcpToolCapability,
} from "@/lib/domains/mcp/service";
import { swallow } from "@/lib/platform/swallow";
import { getActiveScope } from "@/lib/workspace";

export type GovernedMcpActionState =
  | { ok: true; message: string; error?: never }
  | { ok?: never; message?: never; error: string }
  | null;

// Same order as app/api/service-keys: authenticate, resolve the workspace,
// require Admin, then the demo-tenant write guard.
async function requireMcpAdmin() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { error: "Authentication required." } as const;
  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) return { error: "Workspace context unavailable." } as const;
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: ctx.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) {
    return { error: "Admin permission is required." } as const;
  }
  const write = verifyWriteAccess(session.tenantId);
  if (!write.allowed) return { error: write.error ?? "Write access denied." } as const;
  return { session, ctx } as const;
}

export async function registerGovernedMcpTool(
  _prev: GovernedMcpActionState,
  formData: FormData,
): Promise<GovernedMcpActionState> {
  const guard = await requireMcpAdmin();
  if ("error" in guard) return { error: guard.error ?? "Permission denied." };

  const serverName = field(formData, "serverName", 128);
  const toolName = field(formData, "toolName", 128);
  const connector = field(formData, "connector", 128);
  const action = field(formData, "action", 128);
  if (!serverName || !toolName || !connector || !action) {
    return { error: "Server, tool, connector and action are all required." };
  }

  try {
    const result = await registerMcpTool({
      tenantId: guard.session.tenantId,
      workspaceId: guard.ctx.workspaceId,
      actorId: guard.session.principalId,
      serverName,
      serverUrl: field(formData, "serverUrl", 512) || null,
      toolName,
      connector,
      action,
      description: field(formData, "description", 512),
    });
    revalidatePath("/admin/governed-mcp");
    return {
      ok: true,
      message: result.created
        ? `Registered ${serverName}.${toolName}. It grants nothing until you grant it.`
        : `Updated ${serverName}.${toolName}. Existing grants are unchanged.`,
    };
  } catch (error) {
    console.error("[governed-mcp] registerMcpTool failed", error);
    return { error: "Could not register the tool. Try again." };
  }
}

export async function grantGovernedMcpTool(
  _prev: GovernedMcpActionState,
  formData: FormData,
): Promise<GovernedMcpActionState> {
  const guard = await requireMcpAdmin();
  if ("error" in guard) return { error: guard.error ?? "Permission denied." };

  const registryId = field(formData, "registryId", 64);
  if (!registryId) return { error: "Select a registered tool first." };

  // Blank means the wider grant in both cases, so say which one was made.
  const agentId = field(formData, "agentId", 128) || null;
  const environment = field(formData, "environment", 64) || "*";

  try {
    await grantMcpToolCapability({
      tenantId: guard.session.tenantId,
      workspaceId: guard.ctx.workspaceId,
      actorId: guard.session.principalId,
      registryId,
      agentId,
      environment,
    });
    revalidatePath("/admin/governed-mcp");
    return {
      ok: true,
      message: `Granted to ${agentId ? `agent ${agentId}` : "every agent in this workspace"} in ${
        environment === "*" ? "every environment" : environment
      }.`,
    };
  } catch (error) {
    console.error("[governed-mcp] grantMcpToolCapability failed", error);
    return { error: "Could not grant the tool. Try again." };
  }
}

export async function revokeGovernedMcpGrant(
  _prev: GovernedMcpActionState,
  formData: FormData,
): Promise<GovernedMcpActionState> {
  const guard = await requireMcpAdmin();
  if ("error" in guard) return { error: guard.error ?? "Permission denied." };

  const grantId = field(formData, "grantId", 64);
  if (!grantId) return { error: "Missing grant." };

  try {
    const revoked = await revokeMcpToolCapability({
      tenantId: guard.session.tenantId,
      workspaceId: guard.ctx.workspaceId,
      actorId: guard.session.principalId,
      grantId,
    });
    revalidatePath("/admin/governed-mcp");
    return revoked
      ? { ok: true, message: "Revoked. The next call for it is denied." }
      : { error: "That grant is no longer in this workspace." };
  } catch (error) {
    console.error("[governed-mcp] revokeMcpToolCapability failed", error);
    return { error: "Could not revoke the grant. Try again." };
  }
}

function field(formData: FormData, name: string, max: number): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
