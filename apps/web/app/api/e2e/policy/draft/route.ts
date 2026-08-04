import { parseAgtPolicyDocument } from "@spctre/policy-schema";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { getBooleanEnv } from "@/lib/platform/config";
import { persistImportedBranch } from "@/lib/repositories/policy";
import { reservedStableRuleIdError } from "@/lib/policy/reserved-rule-ids";
import { runWithTenantContext } from "@/lib/tenant-context";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v)).filter(Boolean) : [];
}

/**
 * E2E support route: import a draft policy branch without auto-approving or publishing.
 * Use /api/e2e/policy/approve to submit approvals and /api/e2e/policy/publish to publish.
 *
 * Body: { source, branchName, sourcePath?, targetStacks? }
 * Returns: { branchId, revisionId, sourceHash }
 */
async function handlePostApiE2ePolicyDraft(request: Request) {
  const traceId = extractTraceId(request);
  if (!getBooleanEnv("SPCTRE_E2E_API_ENABLED", false)) {
    return withTraceId(
      Response.json(
        { error: "E2E support API is disabled.", meta: makeMeta(traceId) },
        { status: 404 },
      ),
      traceId,
    );
  }

  const tokenAuth = await authenticateServiceToken(request, "e2e:write");
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
  const sourcePath = asString(rec.sourcePath) || "e2e/policy.yaml";
  const targetStacks = asStringArray(rec.targetStacks);

  if (!source)
    return withTraceId(
      Response.json({ error: "source is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  if (!branchName)
    return withTraceId(
      Response.json({ error: "branchName is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );

  const parsed = parseAgtPolicyDocument({ document: source, sourcePath });
  const errors = parsed.diagnostics.filter((d) => d.severity === "ERROR");
  if (errors.length) {
    return withTraceId(
      Response.json(
        { error: errors.map((d) => d.message).join("; "), meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const reservedRuleIdError = reservedStableRuleIdError(
    parsed.rules.map((rule) => rule.stableRuleId),
  );
  if (reservedRuleIdError) {
    return withTraceId(
      Response.json({ error: reservedRuleIdError, meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  try {
    const imported = await runWithTenantContext(tokenAuth.auth.tenantId, () =>
      persistImportedBranch({
        tenantId: tokenAuth.auth.tenantId,
        workspaceId: tokenAuth.auth.workspaceId,
        authorId: tokenAuth.auth.principalId,
        branchName,
        scope: "WORKSPACE",
        sourcePath,
        source,
        rules: parsed.rules,
        metadata: parsed.metadata,
        sourceDocument: parsed.sourceDocument,
        compatibility: parsed.compatibility,
        message: "E2E draft import",
        targetStacks,
      }),
    );

    return withTraceId(
      Response.json(
        {
          branchId: imported.branchId,
          revisionId: imported.revisionId,
          sourceHash: imported.sourceHash,
          meta: makeMeta(traceId),
        },
        { status: 201 },
      ),
      traceId,
    );
  } catch (error) {
    console.error("[e2e/policy/draft] failed:", error);
    return withTraceId(
      Response.json(
        { error: "Unable to import draft policy.", meta: makeMeta(traceId) },
        { status: 500 },
      ),
      traceId,
    );
  }
}

export { handlePostApiE2ePolicyDraft as POST };
