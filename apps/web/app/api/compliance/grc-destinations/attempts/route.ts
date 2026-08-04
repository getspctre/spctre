import { getAuthSession } from "@/lib/auth-session";
import { withApiRoute } from "@/lib/platform/api-route";
import { listGrcDeliveryAttempts } from "@/lib/repositories/grc-delivery-attempts";
import { getActiveScope } from "@/lib/workspace";
import { swallow } from "@/lib/platform/swallow";

const handleGetGrcDeliveryAttempts = withApiRoute(
  "/api/compliance/grc-destinations/attempts",
  async (request, ctx) => {
    const [session, scope] = await Promise.all([
      getAuthSession().catch(swallow("getAuthSession", null)),
      getActiveScope().catch(swallow("getActiveScope", null)),
    ]);
    if (!session || !scope)
      return ctx.error(401, "Authentication and workspace context are required.");
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(requested) ? Math.floor(requested) : 50;
    const attempts = await listGrcDeliveryAttempts({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      destinationId: url.searchParams.get("destinationId")?.trim() || undefined,
      limit,
    });
    return ctx.json({
      attempts: attempts.map((attempt) => ({
        ...attempt,
        createdAt: attempt.created_at.toISOString(),
      })),
    });
  },
);

export { handleGetGrcDeliveryAttempts as GET };
