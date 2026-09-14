import { authenticateServiceToken } from "@/lib/service-tokens";
import { runSimulationDecision } from "@/lib/domains/evidence/service";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Replay retained evidence against a revision, recording a managed simulation
 * run for it.
 *
 * Requires the `simulation:run` scope. The run is attributed to the principal
 * the token was issued to; unlike approving or publishing, this authorizes on
 * the scope alone, because a replay decides nothing — it reports what the
 * revision would have done to traffic that already happened.
 *
 * It exists so a pipeline can finish the reviewed path. On a workspace entitled
 * to bulk production simulation, publish is blocked until a managed replay has
 * run for the revision, and that replay was reachable only from the console —
 * so an automated promotion could collect every approval and then stop at a
 * gate it had no way to satisfy. The gate keeps its teeth either way: publish
 * still refuses a run whose regressions are blocking.
 *
 * Body: { branchId, revisionId }
 * Returns: { runId, branchId, revisionId, total, newlyDenied, newlyAllowed, unchanged }
 */
async function handlePostApiV1Simulations(request: Request) {
  const traceId = extractTraceId(request);

  const tokenAuth = await authenticateServiceToken(request, "simulation:run");
  if (!tokenAuth.ok) {
    return withTraceId(
      Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }),
      traceId,
    );
  }

  const writeCheck = verifyWriteAccess(tokenAuth.auth.tenantId);
  if (!writeCheck.allowed) {
    return withTraceId(
      Response.json(
        { error: writeCheck.error ?? "Write access denied.", meta: makeMeta(traceId) },
        { status: 403 },
      ),
      traceId,
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(
      Response.json(
        { error: "Request body must be an object.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const rec = body as Record<string, unknown>;
  const branchId = asString(rec.branchId);
  const revisionId = asString(rec.revisionId);

  if (!branchId || !revisionId) {
    return withTraceId(
      Response.json(
        { error: "branchId and revisionId are required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const result = await runSimulationDecision(
    { branchId, revisionId },
    {
      tenantId: tokenAuth.auth.tenantId,
      workspaceId: tokenAuth.auth.workspaceId,
      actorId: tokenAuth.auth.principalId,
    },
  );

  if ("error" in result) {
    // Nothing to replay is a state, not a malformed request: a workspace with
    // no retained evidence for the revision has simply not produced any yet.
    const empty = result.error.startsWith("No evidence or revision data");
    return withTraceId(
      Response.json(
        { error: result.error, meta: makeMeta(traceId) },
        { status: empty ? 422 : 500 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json(
      { ...result, meta: makeMeta(traceId) },
      { status: 201, headers: { "cache-control": "no-store" } },
    ),
    traceId,
  );
}

export { handlePostApiV1Simulations as POST };
