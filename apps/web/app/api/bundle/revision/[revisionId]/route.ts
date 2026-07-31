import { getAuthSession } from "@/lib/auth-session";
import { getReviewArtifacts, listBranches } from "@/lib/repositories/policy";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { buildPolicyBundleExport, verifyPolicyBundleExport } from "@spctre/policy-schema";
import type { PolicyBundleExportFormat } from "@spctre/policy-schema";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const EXPORT_FORMATS = new Set<PolicyBundleExportFormat>([
  "spctre-json",
  "opa-rego",
  "opa-bundle",
  "cedar",
  "mcp-proxy-config",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ revisionId: string }> }
) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) {
    return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }

  const { revisionId } = await params;
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branch")?.trim();
  const format = url.searchParams.get("format") as PolicyBundleExportFormat | null;
  if (!branchId) {
    return withTraceId(Response.json({ error: "branch is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (format && !EXPORT_FORMATS.has(format)) {
    return withTraceId(Response.json({ error: "Unsupported bundle export format.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const scope = await getActiveScope();
  const branch = await listBranches(scope.workspaceId, scope.tenantId).then((branches) => branches.find((item) => item.id === branchId)).catch(swallow("listBranches", undefined));
  if (!branch || branch.activeRevision !== revisionId) {
    return withTraceId(Response.json({ error: "The reviewed revision is unavailable in this workspace.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }
  const artifacts = await getReviewArtifacts(branchId, revisionId, scope.workspaceId, scope.tenantId).catch(swallow("getReviewArtifacts", null));
  if (!artifacts) {
    return withTraceId(Response.json({ error: "The reviewed revision is unavailable.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }

  if (format) {
    const exported = buildPolicyBundleExport({ bundle: artifacts.bundle, format, generatedAt: artifacts.bundle.generatedAt });
    const verification = verifyPolicyBundleExport({ artifact: exported.artifact, manifest: exported.manifest });
    const body = exported.ok
      ? { artifact: exported.artifact, manifest: exported.manifest, meta: makeMeta(traceId) }
      : { error: "Bundle export is blocked because target semantics could not be preserved.", manifest: exported.manifest, meta: makeMeta(traceId) };
    return withTraceId(Response.json(body, {
      status: exported.ok && verification.ok ? 200 : 409,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${exported.fileName}.export.json"`,
        "x-spctre-branch-id": branchId,
        "x-spctre-revision-id": revisionId,
        "x-spctre-artifact-hash": artifacts.artifact.artifactHash,
      },
    }), traceId);
  }

  return withTraceId(new Response(JSON.stringify(artifacts.bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="spctre-${revisionId.slice(0, 8)}-reviewed-bundle.json"`,
      "cache-control": "no-store",
      "x-spctre-branch-id": branchId,
      "x-spctre-revision-id": revisionId,
      "x-spctre-artifact-hash": artifacts.artifact.artifactHash,
    },
  }), traceId);
}
