import {
  extractTraceId,
  makeMeta,
  parseBody,
  PublicationSigningKeyEnrollSchema,
  withTraceId,
} from "@spctre/api-contracts";
import { verifyPublicationSigningChallenge } from "@spctre/policy-schema";
import {
  consumePublicationSigningChallenge,
  listPublicationSigningKeys,
} from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handleGetPublicationSigningKeys(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "evidence:manage");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const entityRef = new URL(request.url).searchParams.get("entityRef") ?? undefined;
  const keys = await runWithTenantContext(auth.auth.tenantId, () =>
    listPublicationSigningKeys({
      tenantId: auth.auth.tenantId,
      workspaceId: auth.auth.workspaceId,
      entityRef,
    }),
  );
  return withTraceId(Response.json({ keys, meta: makeMeta(traceId) }), traceId);
}

async function handlePostPublicationSigningKey(request: Request) {
  const traceId = extractTraceId(request);
  const parsed = parseBody(
    PublicationSigningKeyEnrollSchema,
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
  const auth = await authenticateServiceToken(request, "evidence:manage");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const { proof } = parsed.value;
  if (
    proof.payload.challengeId !== parsed.value.challengeId ||
    proof.signature.publicKey !== parsed.value.publicKey ||
    !verifyPublicationSigningChallenge(proof).verified
  )
    return withTraceId(
      Response.json(
        { error: "Signing-key ownership proof is invalid.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  try {
    const key = await runWithTenantContext(auth.auth.tenantId, () =>
      consumePublicationSigningChallenge({
        ...parsed.value,
        challenge: proof.payload.challenge,
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
        enrolledBy: auth.auth.principalId,
      }),
    );
    return withTraceId(Response.json({ key, meta: makeMeta(traceId) }, { status: 201 }), traceId);
  } catch (error) {
    return withTraceId(
      Response.json(
        {
          error: error instanceof Error ? error.message : "Could not enroll signing key.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
}

export { handleGetPublicationSigningKeys as GET, handlePostPublicationSigningKey as POST };
