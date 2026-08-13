import {
  extractTraceId,
  makeMeta,
  parseBody,
  PublicationSigningKeyRevokeSchema,
  withTraceId,
} from "@spctre/api-contracts";
import { revokePublicationSigningKey } from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handleDeletePublicationSigningKey(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const traceId = extractTraceId(request);
  const parsed = parseBody(
    PublicationSigningKeyRevokeSchema,
    await request.json().catch(() => ({})),
  );
  if (!parsed.ok)
    return withTraceId(
      Response.json(
        { error: parsed.error, issues: parsed.issues, meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  const auth = await authenticateServiceToken(request, "evidence:manage");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const { id } = await context.params;
  const revoked = await runWithTenantContext(auth.auth.tenantId, () =>
    revokePublicationSigningKey({
      tenantId: auth.auth.tenantId,
      workspaceId: auth.auth.workspaceId,
      keyId: id,
      revokedBy: auth.auth.principalId,
      reason: parsed.value.reason,
    }),
  );
  if (!revoked)
    return withTraceId(
      Response.json(
        { error: "Signing key not found or already revoked.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  return withTraceId(Response.json({ revoked: true, meta: makeMeta(traceId) }), traceId);
}

export { handleDeletePublicationSigningKey as DELETE };
