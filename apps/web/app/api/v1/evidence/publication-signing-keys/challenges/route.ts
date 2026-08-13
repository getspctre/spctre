import {
  extractTraceId,
  makeMeta,
  parseBody,
  PublicationSigningKeyChallengeSchema,
  withTraceId,
} from "@spctre/api-contracts";
import { createPublicationSigningChallenge } from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handlePostPublicationSigningKeyChallenge(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "evidence:manage");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const parsed = parseBody(
    PublicationSigningKeyChallengeSchema,
    await request.json().catch(() => null),
  );
  if (!parsed.ok)
    return withTraceId(
      Response.json(
        { error: parsed.error, issues: parsed.issues, meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  try {
    const challenge = await runWithTenantContext(auth.auth.tenantId, () =>
      createPublicationSigningChallenge({
        ...parsed.value,
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
      }),
    );
    return withTraceId(
      Response.json({ ...challenge, meta: makeMeta(traceId) }, { status: 201 }),
      traceId,
    );
  } catch (error) {
    return withTraceId(
      Response.json(
        {
          error: error instanceof Error ? error.message : "Could not create signing challenge.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
}

export { handlePostPublicationSigningKeyChallenge as POST };
