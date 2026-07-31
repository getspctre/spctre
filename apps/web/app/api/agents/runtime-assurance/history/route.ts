import { getAuthSession } from "@/lib/auth-session";
import { withApiRoute } from "@/lib/platform/api-route";
import { listRuntimeAssuranceHistory } from "@/lib/repositories/runtime-assurance";
import { getActiveScope } from "@/lib/workspace";
import { swallow } from "@/lib/platform/swallow";

const handleGetRuntimeAssuranceHistory = withApiRoute("/api/agents/runtime-assurance/history", async (request, ctx) => {
  const [session, scope] = await Promise.all([getAuthSession().catch(swallow("getAuthSession", null)), getActiveScope().catch(swallow("getActiveScope", null))]);
  if (!session || !scope) return ctx.error(401, "Authentication and workspace context are required.");
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId")?.trim();
  if (!agentId) return ctx.error(400, "agentId is required.");
  const requested = Number(url.searchParams.get("limit") ?? "168");
  const limit = Number.isFinite(requested) ? Math.floor(requested) : 168;
  const history = await listRuntimeAssuranceHistory({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, agentId, limit });
  return ctx.json({ agentId, history });
});

export { handleGetRuntimeAssuranceHistory as GET };
