import { eraseEvidencePii } from "@/lib/domains/compliance/service";

import { authenticateServiceToken } from "@/lib/service-tokens";
import { EvidenceEraseRequestSchema, parseBody } from "@spctre/api-contracts";
import { withApiRoute } from "@/lib/platform/api-route";
import { logger } from "@spctre/platform/logging";

export const dynamic = "force-dynamic";

export const POST = withApiRoute("/api/evidence/erase", async (request, ctx) => {
  const auth = await authenticateServiceToken(request, "evidence:write");
  if (!auth.ok) {
    return ctx.error(401, "Invalid or expired service token.");
  }

  const { tenantId, workspaceId, principalId } = auth.auth;

  const body = await request.json().catch(() => null);
  // Erasure is irreversible: a filter that is present but invalid must fail
  // the request instead of being dropped, which would silently widen the
  // erasure scope — the schema enforces that, including a strict ISO-8601
  // shape for `before`.
  const parsed = parseBody(EvidenceEraseRequestSchema, body ?? {});
  if (!parsed.ok) return ctx.error(400, parsed.error);
  const filters = parsed.value;

  if (!filters.decisionIds && !filters.agentId && !filters.before) {
    return ctx.error(400, "Erasure requires at least one filter: decisionIds, agentId, or before (ISO timestamp).");
  }

  const result = await eraseEvidencePii(workspaceId, tenantId, filters, principalId).catch((err) => {
    logger.error("evidence.erasure_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  });

  if (!result) {
    return ctx.error(500, "Erasure operation failed.");
  }

  return ctx.json({
    ok: true,
    erasedCount: result.erasedCount,
    erasedDecisionIds: result.erasedDecisionIds,
  });
});
