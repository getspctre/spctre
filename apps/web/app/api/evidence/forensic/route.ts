import { getAuthSession } from "@/lib/auth-session";
import { isFeatureEntitled } from "@/lib/entitlements/features";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { queryForensicEvidence } from "@/lib/domains/evidence/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 10_000;

async function handleGetApiForensicEvidence(request: Request) {
  const traceId = extractTraceId(request);

  let tenantId: string;
  let workspaceId: string;
  const hasBearer = (request.headers.get("authorization") ?? "").startsWith("Bearer ");
  if (hasBearer) {
    const auth = await authenticateServiceToken(request, "compliance:read");
    if (!auth.ok) {
      return withTraceId(
        Response.json(
          { error: "Invalid or expired service token.", meta: makeMeta(traceId) },
          { status: 401 },
        ),
        traceId,
      );
    }
    tenantId = auth.auth.tenantId;
    workspaceId = auth.auth.workspaceId;
  } else {
    const session = await getAuthSession().catch(swallow("getAuthSession", null));
    if (!session) {
      return withTraceId(
        Response.json(
          { error: "Authentication required.", meta: makeMeta(traceId) },
          { status: 401 },
        ),
        traceId,
      );
    }
    const scope = await getActiveScope();
    tenantId = scope.tenantId;
    workspaceId = scope.workspaceId;
  }

  if (!(await isFeatureEntitled("longTermForensicArchival", tenantId))) {
    return withTraceId(
      Response.json(
        {
          error: "Forensic evidence query requires a Cloud or Enterprise plan.",
          meta: makeMeta(traceId),
        },
        { status: 402 },
      ),
      traceId,
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "1000") || 1000, 1),
    MAX_LIMIT,
  );
  const from = parseDateParam(url.searchParams.get("from"));
  const to = parseDateParam(url.searchParams.get("to"));
  const cursor = parseDateParam(url.searchParams.get("cursor"));

  let rows: Awaited<ReturnType<typeof queryForensicEvidence>>;
  try {
    rows = await queryForensicEvidence({ tenantId, workspaceId, limit, from, to, cursor });
  } catch (err) {
    if (err instanceof Error && err.message === "Database not configured.") {
      return withTraceId(
        Response.json(
          { error: "Database not configured.", meta: makeMeta(traceId) },
          { status: 503 },
        ),
        traceId,
      );
    }
    throw err;
  }

  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit ? (page[page.length - 1]?.created_at.toISOString() ?? null) : null;

  return withTraceId(
    Response.json({
      records: page.map((row) => ({
        decisionId: row.decision_id,
        environment: row.environment,
        runtimeTarget: { stack: row.runtime_stack, adapter: row.runtime_adapter ?? undefined },
        agentId: row.agent_id,
        connector: row.connector,
        action: row.action,
        status: row.status,
        reason: row.reason,
        policyRefs: row.policy_refs ?? [],
        artifactHash: row.artifact_hash,
        policyContext: Array.isArray(row.policy_context) ? row.policy_context : [],
        rawEvidence:
          row.raw_evidence && typeof row.raw_evidence === "object" ? row.raw_evidence : {},
        latencyMs: row.latency_ms ?? 0,
        createdAt: row.created_at.toISOString(),
      })),
      pagination: { limit, nextCursor, hasMore: Boolean(nextCursor) },
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export { handleGetApiForensicEvidence as GET };
