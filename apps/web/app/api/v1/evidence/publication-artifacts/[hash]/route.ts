import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { readPublicationContentArtifact } from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handleGetPublicationArtifact(
  request: Request,
  context: { params: Promise<{ hash: string }> },
) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "evidence:export");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const { hash } = await context.params;
  const artifact = await runWithTenantContext(auth.auth.tenantId, () =>
    readPublicationContentArtifact({
      tenantId: auth.auth.tenantId,
      workspaceId: auth.auth.workspaceId,
      contentHash: hash,
    }),
  );
  if (!artifact)
    return withTraceId(
      Response.json(
        { error: "Publication artifact not found.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  return withTraceId(
    new Response(Buffer.from(artifact.bytes), {
      headers: {
        "content-type": artifact.mediaType,
        "content-disposition": `attachment; filename="publication-${hash.slice(7, 19)}"`,
        "cache-control": "no-store",
      },
    }),
    traceId,
  );
}

export { handleGetPublicationArtifact as GET };
