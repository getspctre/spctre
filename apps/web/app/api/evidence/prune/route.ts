import { pruneExpiredEvidence } from "@/lib/domains/compliance/service";

import { authenticateServiceToken } from "@/lib/service-tokens";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handlePostApiEvidencePrune(request: Request) {
  const traceId = extractTraceId(request);

  const auth = await authenticateServiceToken(request, "evidence:write");
  if (!auth.ok) {
    return withTraceId(
      Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }),
      traceId
    );
  }

  const { tenantId, workspaceId, principalId } = auth.auth;

  const result = await pruneExpiredEvidence(workspaceId, tenantId, principalId).catch((err) => {
    console.error("[evidence/prune] prune failed:", err);
    return null;
  });

  if (!result) {
    return withTraceId(
      Response.json({ error: "Prune operation failed.", meta: makeMeta(traceId) }, { status: 500 }),
      traceId
    );
  }

  return withTraceId(
    Response.json({
      ok: true,
      prunedCount: result.prunedCount,
      prunedDecisionIds: result.prunedDecisionIds,
      meta: makeMeta(traceId),
    }),
    traceId
  );
}

export { handlePostApiEvidencePrune as POST };
