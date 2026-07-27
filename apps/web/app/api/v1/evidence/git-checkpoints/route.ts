import { revalidatePath } from "next/cache";
import {
  extractTraceId,
  GitCheckpointIngestSchema,
  makeMeta,
  parseBody,
  type EvidenceIngestInput,
  withTraceId,
} from "@spctre/api-contracts";
import { incrementCounter } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { ingestRuntimeEvidence } from "@/lib/domains/evidence/ingest-service";

export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/evidence/git-checkpoints";

function errorResponse(traceId: string, status: number, body: Record<string, unknown>) {
  incrementCounter("spctre.api.errors", 1, {
    "http.route": ROUTE,
    "http.response.status_code": status,
  });
  return withTraceId(Response.json({ ...body, meta: makeMeta(traceId) }, { status }), traceId);
}

async function handlePostGitCheckpoint(request: Request) {
  const traceId = extractTraceId(request);
  const startedAt = Date.now();

  return await withSpan("api.evidence.git_checkpoint.ingest", { "spctre.request_id": traceId, "http.route": ROUTE }, async (span) => {
    const payload = await request.json().catch(() => null);
    if (!payload) return errorResponse(traceId, 400, { error: "Request body must be JSON." });

    const parsed = parseBody(GitCheckpointIngestSchema, payload);
    if (!parsed.ok) return errorResponse(traceId, 400, { error: parsed.error, issues: parsed.issues });

    const checkpoint = parsed.value.checkpoint;
    const evidence: EvidenceIngestInput = {
      decisionId: parsed.value.idempotencyKey,
      environment: parsed.value.environment,
      runtimeTarget: { stack: "CUSTOM", adapter: parsed.value.agent?.adapter ?? "git-checkpoint" },
      agentId: parsed.value.agent?.id ?? "git-checkpoint",
      connector: parsed.value.connector ?? "git",
      action: parsed.value.action ?? "checkpoint.ingest",
      status: parsed.value.status,
      reason: parsed.value.reason,
      // Resolve policy context at the checkpoint's timestamp, just as gateway
      // evidence does. Callers may still attach their policy references as
      // metadata without being responsible for server policy resolution.
      ingestMode: "gateway",
      artifactHash: checkpoint.headCommit,
      createdAt: checkpoint.createdAt,
      latencyMs: 0,
      toolIntent: undefined,
      planSummary: undefined,
      toolParameters: undefined,
      rawEvidence: {
        _source: "git-checkpoint",
        checkpoint,
        submittedPolicyRefs: parsed.value.policyRefs,
        metadata: parsed.value.metadata,
      },
    };

    const rawPayload = { ...parsed.value, ingestMode: "gateway" };
    const result = await ingestRuntimeEvidence({
      request,
      parsed: evidence,
      rawPayload,
      startedAt,
    });

    if (result.spanAttributes) span.setAttributes(result.spanAttributes);
    for (const path of result.revalidatePaths ?? []) revalidatePath(path);

    return withTraceId(Response.json({ ...result.body, meta: makeMeta(traceId) }, { status: result.status }), traceId);
  });
}

export { handlePostGitCheckpoint as POST };
