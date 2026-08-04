import { authenticateServiceToken } from "@/lib/service-tokens";
import { getPublishedAgentBlueprintRuntimeByAgent } from "@/lib/domains/agent-blueprints/service";
import { buildAgentBlueprintRuntimeArtifact } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "bundle:read");
  if (!auth.ok)
    return withTraceId(
      Response.json(
        { error: "Invalid or expired service token.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  const agentId = new URL(request.url).searchParams.get("agentId")?.trim();
  if (!agentId)
    return withTraceId(
      Response.json({ error: "agentId is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  const published = await getPublishedAgentBlueprintRuntimeByAgent({
    tenantId: auth.auth.tenantId,
    workspaceId: auth.auth.workspaceId,
    agentId,
  });
  if (!published)
    return withTraceId(
      Response.json(
        { error: "No published Blueprint is assigned to this agent.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  const artifact = buildAgentBlueprintRuntimeArtifact({
    revision: published.revision,
    name: published.name,
    policyArtifactHash: published.policyArtifactHash,
    generatedAt: new Date().toISOString(),
  });
  return withTraceId(
    Response.json(
      { artifact, meta: makeMeta(traceId) },
      {
        headers: {
          "cache-control": "no-store",
          "x-spctre-blueprint-revision-id": artifact.blueprint.revisionId,
          "x-spctre-blueprint-definition-hash": artifact.blueprint.definitionHash,
        },
      },
    ),
    traceId,
  );
}
