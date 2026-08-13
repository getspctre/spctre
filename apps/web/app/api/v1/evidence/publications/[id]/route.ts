import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { getPublicationAttestation } from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handleGetPublication(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "evidence:read");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const { id } = await context.params;
  const attestation = await runWithTenantContext(auth.auth.tenantId, () =>
    getPublicationAttestation({
      tenantId: auth.auth.tenantId,
      workspaceId: auth.auth.workspaceId,
      id,
    }),
  );
  if (!attestation)
    return withTraceId(
      Response.json(
        { error: "Publication attestation not found.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  return withTraceId(Response.json({ attestation, meta: makeMeta(traceId) }), traceId);
}

export { handleGetPublication as GET };
