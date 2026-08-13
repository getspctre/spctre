import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import {
  MAX_PUBLICATION_CONTENT_ARTIFACT_BYTES,
  publicationContentHash,
  retainPublicationContentArtifact,
} from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handlePostPublicationArtifact(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "evidence:write");
  if (!auth.ok) {
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  }
  const mediaType = (request.headers.get("content-type") ?? "").split(";", 1)[0];
  const claimedHash = request.headers.get("x-spctre-content-hash") ?? "";
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_PUBLICATION_CONTENT_ARTIFACT_BYTES) {
    return withTraceId(
      Response.json(
        { error: "Publication artifact exceeds 10 MiB.", meta: makeMeta(traceId) },
        { status: 413 },
      ),
      traceId,
    );
  }
  if (publicationContentHash(bytes) !== claimedHash) {
    return withTraceId(
      Response.json({ error: "Content hash mismatch.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }
  try {
    await runWithTenantContext(auth.auth.tenantId, () =>
      retainPublicationContentArtifact({
        contentHash: claimedHash,
        bytes,
        mediaType,
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
      }),
    );
  } catch (error) {
    return withTraceId(
      Response.json(
        {
          error: error instanceof Error ? error.message : "Artifact retention failed.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
  return withTraceId(
    Response.json(
      { contentHash: claimedHash, retained: true, meta: makeMeta(traceId) },
      { status: 201 },
    ),
    traceId,
  );
}

export { handlePostPublicationArtifact as POST };
