import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { readPolicyContentArtifactForEvidenceToken } from "@/lib/repositories/policy-content-artifacts";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handleGetPolicyArtifact(
  request: Request,
  { params }: { params: Promise<{ contentHash: string }> },
) {
  const traceId = extractTraceId(request);
  const { contentHash } = await params;
  if (!/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
    return withTraceId(Response.json({ error: "Invalid content hash.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  const auth = await authenticateServiceToken(request, "evidence:export");
  if (!auth.ok || !auth.auth.connector || !auth.auth.evidenceExportGrants.length) {
    return withTraceId(Response.json({ error: "Invalid or insufficient service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
  }
  // Destructured before the closure: narrowing on `auth.auth.connector` above
  // does not survive into a callback body.
  const { tenantId, workspaceId, tokenId, connector, evidenceExportGrants } = auth.auth;
  const artifact = await runWithTenantContext(tenantId, () =>
    readPolicyContentArtifactForEvidenceToken({
      tenantId,
      workspaceId,
      tokenId,
      connector,
      grants: evidenceExportGrants,
      contentHash,
    }),
  );
  if (!artifact) {
    return withTraceId(Response.json({ error: "Artifact not found.", meta: makeMeta(traceId) }, { status: 404 }), traceId);
  }
  return withTraceId(
    new Response(Buffer.from(artifact.bytes), {
      headers: { "content-type": artifact.mediaType, "cache-control": "no-store" },
    }),
    traceId,
  );
}

export { handleGetPolicyArtifact as GET };
