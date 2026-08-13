import {
  extractTraceId,
  makeMeta,
  parseBody,
  PublicationAttestationIngestSchema,
  withTraceId,
} from "@spctre/api-contracts";
import { canonicalizeReceiptPayload, verifyPublicationAttestation } from "@spctre/policy-schema";
import {
  insertPublicationAttestation,
  findTrustedPublicationSigningKey,
  listPublicationAttestations,
  publicationArtifactExists,
  resolvePublicationPolicyContext,
} from "@/lib/repositories/publication-attestations";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function handleGetPublications(request: Request) {
  const traceId = extractTraceId(request);
  const auth = await authenticateServiceToken(request, "evidence:read");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  try {
    const attestations = await runWithTenantContext(auth.auth.tenantId, () =>
      listPublicationAttestations({
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
        contentIdentity: url.searchParams.get("contentIdentity") ?? undefined,
        before: url.searchParams.get("before") ?? undefined,
        limit,
      }),
    );
    return withTraceId(Response.json({ attestations, meta: makeMeta(traceId) }), traceId);
  } catch (error) {
    return withTraceId(
      Response.json(
        {
          error: error instanceof Error ? error.message : "Publication query failed.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
}

async function handlePostPublication(request: Request) {
  const traceId = extractTraceId(request);
  const payload = await request.json().catch(() => null);
  if (!payload)
    return withTraceId(
      Response.json(
        { error: "Request body must be JSON.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  const parsed = parseBody(PublicationAttestationIngestSchema, payload);
  if (!parsed.ok)
    return withTraceId(
      Response.json(
        { error: parsed.error, issues: parsed.issues, meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  if (parsed.value.attestation.content.artifactRef !== parsed.value.attestation.content.hash) {
    return withTraceId(
      Response.json(
        {
          error: "content.artifactRef must identify the exact content hash.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
  const auth = await authenticateServiceToken(request, "evidence:write");
  if (!auth.ok)
    return withTraceId(
      Response.json({ error: auth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );

  const receipt = parsed.value.receipt;
  const receiptVerified = receipt
    ? verifyPublicationAttestation(receipt as Parameters<typeof verifyPublicationAttestation>[0])
    : null;
  if (receipt && !receiptVerified?.verified) {
    return withTraceId(
      Response.json(
        {
          error: receiptVerified?.reason ?? "Invalid publication-attestation receipt.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
  if (
    receipt &&
    canonicalizeReceiptPayload(receipt.payload as { schema: string }) !==
      canonicalizeReceiptPayload(parsed.value.attestation)
  ) {
    return withTraceId(
      Response.json(
        { error: "Receipt payload does not match attestation.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  try {
    const result = await runWithTenantContext(auth.auth.tenantId, async () => {
      const artifactExists = await publicationArtifactExists({
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
        contentHash: parsed.value.attestation.content.artifactRef,
      });
      if (!artifactExists)
        throw new Error("Referenced publication content artifact was not found.");
      if (receipt) {
        const trustedKey = await findTrustedPublicationSigningKey({
          tenantId: auth.auth.tenantId,
          workspaceId: auth.auth.workspaceId,
          entityRef: parsed.value.attestation.publisher.entityRef.value,
          keyId: receipt.signature.keyId,
          publicKey: receipt.signature.publicKey,
        });
        if (!trustedKey)
          throw new Error(
            "Receipt signing key is not an active, ownership-verified key for the accountable publisher.",
          );
      }
      const policyContext = await resolvePublicationPolicyContext({
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
        at: parsed.value.attestation.timestamps.attestedAt.value,
      });
      return insertPublicationAttestation({
        tenantId: auth.auth.tenantId,
        workspaceId: auth.auth.workspaceId,
        idempotencyKey: parsed.value.idempotencyKey,
        attestation: parsed.value.attestation,
        receipt: receipt as Record<string, unknown> | undefined,
        receiptVerified: Boolean(receiptVerified?.verified),
        policyContext,
      });
    });
    return withTraceId(
      Response.json(
        {
          attestationId: result.id,
          deduplicated: result.deduplicated,
          receiptVerified: receipt ? Boolean(receiptVerified?.verified) : null,
          meta: makeMeta(traceId),
        },
        { status: result.deduplicated ? 200 : 201 },
      ),
      traceId,
    );
  } catch (error) {
    return withTraceId(
      Response.json(
        {
          error: error instanceof Error ? error.message : "Publication attestation failed.",
          meta: makeMeta(traceId),
        },
        { status: 400 },
      ),
      traceId,
    );
  }
}

export { handleGetPublications as GET, handlePostPublication as POST };
