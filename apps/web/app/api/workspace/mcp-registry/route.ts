import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { listMcpToolRegistry, registerMcpTool } from "@/lib/domains/mcp/service";
import { resolveMcpRegistryScope } from "./_guard";

export const dynamic = "force-dynamic";

async function handleGetApiWorkspaceMcpRegistry(request: Request) {
  const traceId = extractTraceId(request);
  const scope = await resolveMcpRegistryScope(traceId, { write: false });
  if (scope instanceof Response) return scope;

  let tools;
  try {
    tools = await listMcpToolRegistry({ tenantId: scope.tenantId, workspaceId: scope.workspaceId });
  } catch (error) {
    console.error("[workspace/mcp-registry] listMcpToolRegistry failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json({ tools, count: tools.length, meta: makeMeta(traceId) }),
    traceId,
  );
}

// Register a governed MCP tool, or update one already registered:
// (tenant, serverName, toolName) is unique, so this is an upsert and repeat
// registration does not fork the row the grants point at.
async function handlePostApiWorkspaceMcpRegistry(request: Request) {
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

  const serverName = text(body.serverName, 128);
  const toolName = text(body.toolName, 128);
  const connector = text(body.connector, 128);
  const action = text(body.action, 128);
  const missing = [
    ["serverName", serverName],
    ["toolName", toolName],
    ["connector", connector],
    ["action", action],
  ]
    .filter(([, value]) => !value)
    .map(([field]) => field);
  if (missing.length) {
    return withTraceId(
      Response.json(
        {
          error: `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required.`,
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }

  const status = body.status === "DISABLED" ? "DISABLED" : "ACTIVE";
  const serverUrl = text(body.serverUrl, 512) || null;
  if (serverUrl && !isHttpUrl(serverUrl)) {
    return withTraceId(
      Response.json(
        { error: "serverUrl must be an http(s) URL.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  let result;
  try {
    result = await registerMcpTool({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      actorId: scope.principalId,
      serverName,
      serverUrl,
      toolName,
      connector,
      action,
      description: text(body.description, 512),
      inputSchema: record(body.inputSchema),
      metadata: record(body.metadata),
      status,
    });
  } catch (error) {
    console.error("[workspace/mcp-registry] registerMcpTool failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json(
      {
        id: result.id,
        created: result.created,
        serverName,
        toolName,
        connector,
        action,
        status,
        meta: makeMeta(traceId),
      },
      { status: result.created ? 201 : 200 },
    ),
    traceId,
  );
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

export { handleGetApiWorkspaceMcpRegistry as GET };
export { handlePostApiWorkspaceMcpRegistry as POST };
