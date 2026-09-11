import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { revokeMcpToolCapability } from "@/lib/domains/mcp/service";
import { resolveMcpRegistryScope } from "../../_guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleDeleteApiWorkspaceMcpRegistryGrant(
  request: Request,
  context: { params: Promise<{ grantId: string }> },
) {
  const traceId = extractTraceId(request);
  const scope = await resolveMcpRegistryScope(traceId, { write: true });
  if (scope instanceof Response) return scope;

  const { grantId: rawGrantId } = await context.params;
  const grantId = decodeURIComponent(rawGrantId ?? "").trim();
  if (!UUID.test(grantId)) {
    return withTraceId(
      Response.json({ error: "grantId must be a UUID.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  let revoked: boolean;
  try {
    revoked = await revokeMcpToolCapability({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorId: scope.principalId,
      grantId,
    });
  } catch (error) {
    console.error("[workspace/mcp-registry] revokeMcpToolCapability failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  // A grant that is not there is the state the caller asked for, but saying so
  // matters: a revoke that silently succeeded against the wrong workspace would
  // leave an operator believing a capability was withdrawn when it was not.
  if (!revoked) {
    return withTraceId(
      Response.json(
        { error: "No such grant in this workspace.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }

  return withTraceId(Response.json({ revoked: true, meta: makeMeta(traceId) }), traceId);
}

export { handleDeleteApiWorkspaceMcpRegistryGrant as DELETE };
