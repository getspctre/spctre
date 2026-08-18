import { authenticateServiceToken } from "@/lib/service-tokens";
import { importPolicyForToken, previewPolicyImport } from "@/lib/domains/policy/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v)).filter(Boolean) : [];
}

function asSourceFormat(value: unknown): "AGT_YAML" | "OPA_REGO" | "CEDAR" | undefined {
  const format = asString(value);
  return format === "AGT_YAML" || format === "OPA_REGO" || format === "CEDAR" ? format : undefined;
}

/**
 * Authenticated, idempotent policy import for automation/CI (operator identity).
 *
 * Requires the `policy:import` scope, which is admin-issuable only and is never
 * granted to runtime agent tokens — so a governed agent can never import its
 * own policy. This route drafts a branch/revision only; it never approves or
 * publishes. Review, approval, and publication remain manual in the control
 * plane.
 *
 * Body: { source, branchName, scope?, connector?, environment?, sourcePath?, targetStacks? }
 * Returns: { branchId, revisionId, sourceHash, created, alreadyCurrent, ruleCount }
 *   201 when a new branch was created; 200 when an existing branch was updated
 *   or was already current.
 */
async function handlePostApiV1PolicyImports(request: Request) {
  const traceId = extractTraceId(request);

  const tokenAuth = await authenticateServiceToken(request, "policy:import");
  if (!tokenAuth.ok) {
    return withTraceId(
      Response.json({ error: tokenAuth.error, meta: makeMeta(traceId) }, { status: 401 }),
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
  const source = asString(rec.source);
  const branchName = asString(rec.branchName);
  const scope = asString(rec.scope) || "WORKSPACE";
  const connector = asString(rec.connector);
  const environment = asString(rec.environment);
  const sourcePath = asString(rec.sourcePath) || `imports/${branchName || "policy"}.yaml`;
  const targetStacks = asStringArray(rec.targetStacks);
  const sourceFormat = asSourceFormat(rec.sourceFormat);
  if (rec.sourceFormat !== undefined && !sourceFormat) {
    return withTraceId(
      Response.json({ error: "sourceFormat must be AGT_YAML, OPA_REGO, or CEDAR.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  if (rec.dryRun === true) {
    const preview = previewPolicyImport({
      source,
      branchName,
      scope,
      connector,
      environment,
      sourcePath,
      sourceFormat,
    });
    if ("error" in preview) {
      return withTraceId(Response.json({ error: preview.error, meta: makeMeta(traceId) }, { status: 400 }), traceId);
    }
    return withTraceId(
      Response.json(
        { dryRun: true, ruleCount: preview.result.rules.length, ...preview.result, meta: makeMeta(traceId) },
        { headers: { "cache-control": "no-store" } },
      ),
      traceId,
    );
  }

  const outcome = await importPolicyForToken({
    tenantId: tokenAuth.auth.tenantId,
    workspaceId: tokenAuth.auth.workspaceId,
    principalId: tokenAuth.auth.principalId,
    source,
    branchName,
    scope,
    connector,
    environment,
    sourcePath,
    sourceFormat,
    targetStacks,
  });

  if ("error" in outcome) {
    return withTraceId(
      Response.json(
        { error: outcome.error, meta: makeMeta(traceId) },
        { status: outcome.status ?? 400 },
      ),
      traceId,
    );
  }

  const { result } = outcome;
  return withTraceId(
    Response.json(
      {
        branchId: result.branchId,
        revisionId: result.revisionId,
        sourceHash: result.sourceHash,
        created: result.created,
        alreadyCurrent: result.alreadyCurrent,
        ruleCount: result.ruleCount,
        meta: makeMeta(traceId),
      },
      { status: result.created ? 201 : 200, headers: { "cache-control": "no-store" } },
    ),
    traceId,
  );
}

export { handlePostApiV1PolicyImports as POST };
