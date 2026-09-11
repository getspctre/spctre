import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { grantMcpToolCapability } from "@/lib/domains/mcp/service";
import { resolveMcpRegistryScope } from "../_guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Grant a registered tool to this workspace, optionally narrowed to one agent
// and one environment. Omitting agentId grants to every agent in the workspace;
// omitting environment grants in every environment. Both are the wider choice,
// so both are spelled out in the operations-log entry.
async function handlePostApiWorkspaceMcpRegistryGrants(request: Request) {
  const traceId = extractTraceId(request);
  const scope = await resolveMcpRegistryScope(traceId, { write: true });
  if (scope instanceof Response) return scope;

  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return withTraceId(
      Response.json(
        { error: "Request body must be an object.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const registryId = typeof body.registryId === "string" ? body.registryId.trim() : "";
  if (!UUID.test(registryId)) {
    return withTraceId(
      Response.json(
        { error: "registryId must be a UUID.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const agentId =
    typeof body.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim().slice(0, 128)
      : null;
  const environment =
    typeof body.environment === "string" && body.environment.trim()
      ? body.environment.trim().slice(0, 64)
      : "*";

  let grant;
  try {
    grant = await grantMcpToolCapability({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorId: scope.principalId,
      registryId,
      agentId,
      environment,
    });
  } catch (error) {
    // A grant naming a registry row this tenant does not have is a client
    // error, not an outage: the foreign key is what catches it, and answering
    // 503 would send an operator looking for a broken database.
    const message = error instanceof Error ? error.message : String(error);
    if (/not registered|foreign key|violates/i.test(message)) {
      return withTraceId(
        Response.json(
          { error: "registryId does not name a registered MCP tool.", meta: makeMeta(traceId) },
          { status: 404 },
        ),
        traceId,
      );
    }
    console.error("[workspace/mcp-registry] grantMcpToolCapability failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(Response.json({ grant, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handlePostApiWorkspaceMcpRegistryGrants as POST };
