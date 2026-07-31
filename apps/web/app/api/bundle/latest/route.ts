import { getLatestPublishedPolicyBundle } from "@/lib/domains/policy/service";

import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../_route-scope";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { buildPolicyBundleExport, buildPolicyBundleExports, verifyPolicyBundleExport } from "@spctre/policy-schema";
import type { PolicyBundleExportFormat } from "@spctre/policy-schema";
import { appendOperationsLog } from "@/lib/repositories/operations-log/log";
import { insertBundleExportLog } from "@/lib/repositories/bundle-export-log";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const EXPORT_FORMATS = new Set<PolicyBundleExportFormat>([
  "spctre-json",
  "opa-rego",
  "opa-bundle",
  "cedar",
  "mcp-proxy-config",
]);

function parseExportFormat(request: Request): PolicyBundleExportFormat | null | undefined {
  const raw = new URL(request.url).searchParams.get("format");
  if (!raw) return undefined;
  return EXPORT_FORMATS.has(raw as PolicyBundleExportFormat)
    ? raw as PolicyBundleExportFormat
    : null;
}

function isPreviewRequest(request: Request): boolean {
  const raw = new URL(request.url).searchParams.get("preview");
  return raw === "1" || raw === "true";
}

async function handleGetApiBundleLatest(request: Request) {
  const traceId = extractTraceId(request);
  const format = parseExportFormat(request);
  const preview = isPreviewRequest(request);
  if (format === null) {
    return withTraceId(Response.json({
      error: "Unsupported bundle export format.",
      supportedFormats: Array.from(EXPORT_FORMATS),
      meta: makeMeta(traceId),
    }, { status: 400 }), traceId);
  }

  const scope = await resolveRouteScope(request, { serviceTokenScope: "bundle:read", traceId });
  if (scope instanceof Response) return scope;
  const workspaceContext: { workspaceId: string; tenantId: string; principalId: string } = {
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    principalId: scope.actorId,
  };

  let published;
  try {
    published = await getLatestPublishedPolicyBundle({
      workspaceId: workspaceContext.workspaceId,
      tenantId: workspaceContext.tenantId
    });
  } catch (err) {
    console.error("[bundle/latest] getLatestPublishedBundle failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!published) {
    return withTraceId(Response.json(
      { error: "No published policy bundle is available for this workspace.", meta: makeMeta(traceId) },
      { status: 404 }
    ), traceId);
  }

  if (preview && !format) {
    const formats = buildPolicyBundleExports({
      bundle: published.bundle,
      formats: Array.from(EXPORT_FORMATS),
      generatedAt: new Date().toISOString(),
    }).map((exported) => exported.manifest);
    recordBundleExport({
      workspaceContext,
      published,
      format: "preview",
      outcome: "PREVIEW",
      blockingWarnings: formats.flatMap((manifest) => manifest.blockingWarnings),
      verified: null,
    });
    return withTraceId(Response.json({
      formats,
      meta: makeMeta(traceId),
    }, {
      headers: {
        "cache-control": "no-store",
        "x-spctre-branch-id": published.branchId,
        "x-spctre-revision-id": published.revisionId,
        "x-spctre-artifact-hash": published.artifactHash,
        "x-spctre-plan": getSpctrePlan(),
      }
    }), traceId);
  }

  if (format) {
    const exported = buildPolicyBundleExport({
      bundle: published.bundle,
      format,
      generatedAt: new Date().toISOString(),
    });
    const verification = verifyPolicyBundleExport({
      artifact: exported.artifact,
      manifest: exported.manifest,
    });
    if (exported.ok && !verification.ok) {
      return withTraceId(Response.json({
        error: "Bundle export verification failed.",
        verification,
        manifest: exported.manifest,
        meta: makeMeta(traceId),
      }, { status: 500 }), traceId);
    }
    const status = exported.ok ? 200 : 409;
    recordBundleExport({
      workspaceContext,
      published,
      format: exported.format,
      outcome: exported.ok ? "EXPORTED" : "BLOCKED",
      blockingWarnings: exported.manifest.blockingWarnings,
      verified: verification.ok,
      compiledArtifactHash: exported.manifest.compiledArtifactHash,
    });
    const body = exported.ok
      ? { artifact: exported.artifact, manifest: exported.manifest, meta: makeMeta(traceId) }
      : {
          error: "Bundle export blocked because target semantics could not be preserved.",
          manifest: exported.manifest,
          meta: makeMeta(traceId),
        };
    return withTraceId(Response.json(body, {
      status,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${exported.fileName}.export.json"`,
        "x-spctre-branch-id": published.branchId,
        "x-spctre-revision-id": published.revisionId,
        "x-spctre-artifact-hash": published.artifactHash,
        "x-spctre-export-format": exported.format,
        "x-spctre-export-ok": String(exported.ok),
        "x-spctre-export-verified": String(verification.ok),
        "x-spctre-plan": getSpctrePlan(),
      }
    }), traceId);
  }

  const body = JSON.stringify(published.bundle, null, 2);
  const safeArtifactHash = published.artifactHash.replace(/[^a-zA-Z0-9]/g, "-");
  const filename = `spctre-${published.revisionId.slice(0, 8)}-${safeArtifactHash}.json`;

  return withTraceId(new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-spctre-branch-id": published.branchId,
      "x-spctre-revision-id": published.revisionId,
      "x-spctre-artifact-hash": published.artifactHash,
      "x-spctre-published-at": published.publishedAt,
      "x-spctre-plan": getSpctrePlan(),
    }
  }), traceId);
}

export { handleGetApiBundleLatest as GET };

function recordBundleExport(params: {
  workspaceContext: { workspaceId: string; tenantId: string; principalId: string } | null;
  published: {
    branchId: string;
    revisionId: string;
    artifactHash: string;
    publishId: string;
  };
  format: string;
  outcome: "PREVIEW" | "EXPORTED" | "BLOCKED";
  blockingWarnings: string[];
  verified: boolean | null;
  compiledArtifactHash?: string;
}) {
  const { workspaceContext } = params;
  if (!workspaceContext) return;
  appendOperationsLog({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    eventType: "BUNDLE_EXPORT",
    sourceId: params.published.revisionId,
    sourceTable: "policy_revision",
    actorId: workspaceContext.principalId,
    payload: {
      format: params.format,
      outcome: params.outcome,
      branchId: params.published.branchId,
      revisionId: params.published.revisionId,
      artifactHash: params.published.artifactHash,
      publishId: params.published.publishId,
      compiledArtifactHash: params.compiledArtifactHash,
      verified: params.verified,
      blockingWarnings: params.blockingWarnings,
    },
  }).catch(swallow("appendOperationsLog", undefined));
  insertBundleExportLog({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    branchId: params.published.branchId,
    revisionId: params.published.revisionId,
    artifactHash: params.published.artifactHash,
    format: params.format,
    outcome: params.outcome,
    compiledArtifactHash: params.compiledArtifactHash ?? null,
    blockingCount: params.blockingWarnings.length,
    verified: params.verified,
    actorId: workspaceContext.principalId,
  }).catch(swallow("insertBundleExportLog", undefined));
}
