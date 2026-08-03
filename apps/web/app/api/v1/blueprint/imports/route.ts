import { authenticateServiceToken } from "@/lib/service-tokens";
import { importBlueprintForToken } from "@/lib/domains/agent-blueprints/service";
import { parseAgentBlueprintSource } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Authenticated, idempotent Blueprint import for automation/CI (operator identity).
 *
 * Requires the `blueprint:import` scope, which is admin-issuable only and is
 * never granted to runtime agent tokens — so a governed agent can never define
 * its own authority Blueprint. This route drafts a Blueprint/revision only; it
 * never approves or publishes. The source declares its governing policy branch
 * (`definition.policyBranchId`, a branch name) and must not pin a revision; the
 * import resolves that branch's published revision and fails closed if none.
 *
 * Body: { source, sourcePath? } — `source` is the raw YAML/JSON Blueprint source.
 * Returns: { blueprintId, revisionId, definitionHash, created, alreadyCurrent,
 *   policyBranchId, policyRevisionId }. 201 when a new Blueprint was created;
 *   200 when a revision was appended or it was already current.
 */
async function handlePostApiV1BlueprintImports(request: Request) {
  const traceId = extractTraceId(request);

  const tokenAuth = await authenticateServiceToken(request, "blueprint:import");
  if (!tokenAuth.ok) {
    return withTraceId(Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const rec = body as Record<string, unknown>;
  const source = asString(rec.source);
  const sourcePath = asString(rec.sourcePath) || "blueprint.yaml";

  const parsedSource = parseAgentBlueprintSource({ document: source, sourcePath });
  if ("error" in parsedSource) {
    return withTraceId(Response.json({ error: parsedSource.error, meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  const { envelope } = parsedSource;

  const outcome = await importBlueprintForToken({
    tenantId: tokenAuth.auth.tenantId,
    workspaceId: tokenAuth.auth.workspaceId,
    principalId: tokenAuth.auth.principalId,
    name: envelope.name,
    agentId: envelope.agentId,
    message: envelope.message,
    definition: envelope.definition,
  });

  if ("error" in outcome) {
    return withTraceId(Response.json({ error: outcome.error, meta: makeMeta(traceId) }, { status: outcome.status }), traceId);
  }

  const { result } = outcome;
  return withTraceId(
    Response.json(
      {
        blueprintId: result.blueprintId,
        revisionId: result.revisionId,
        definitionHash: result.definitionHash,
        created: result.created,
        alreadyCurrent: result.alreadyCurrent,
        policyBranchId: result.policyBranchId,
        policyRevisionId: result.policyRevisionId,
        meta: makeMeta(traceId),
      },
      { status: result.created ? 201 : 200, headers: { "cache-control": "no-store" } }
    ),
    traceId
  );
}

export { handlePostApiV1BlueprintImports as POST };
