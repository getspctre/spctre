import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { getPublishedAgentBlueprintRuntime } from "@/lib/domains/agent-blueprints/service";
import { buildAgentBlueprintRuntimeArtifact } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = extractTraceId(request);
  const [session, scope] = await Promise.all([
    getAuthSession().catch(swallow("getAuthSession", null)),
    getActiveScope().catch(swallow("getActiveScope", null)),
  ]);
  if (!session || !scope) {
    return withTraceId(
      Response.json(
        { error: "Authentication and workspace context are required.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  }
  const { id } = await params;
  const published = await getPublishedAgentBlueprintRuntime({
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    blueprintId: id,
  });
  if (!published) {
    return withTraceId(
      Response.json(
        { error: "No published Blueprint revision is available.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }
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
          "x-spctre-blueprint-id": artifact.blueprint.blueprintId,
          "x-spctre-blueprint-revision-id": artifact.blueprint.revisionId,
          "x-spctre-blueprint-definition-hash": artifact.blueprint.definitionHash,
        },
      },
    ),
    traceId,
  );
}
