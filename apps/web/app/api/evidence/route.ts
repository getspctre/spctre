import { revalidatePath } from "next/cache";
import {
  EvidenceIngestSchema,
  extractTraceId,
  makeMeta,
  parseBody,
  withTraceId,
} from "@spctre/api-contracts";
import { incrementCounter } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { ingestRuntimeEvidence } from "@/lib/domains/evidence/ingest-service";
import { delegateToGoIngestor } from "./ingest-helpers";

export const dynamic = "force-dynamic";

const EVIDENCE_ROUTE = "/api/evidence";

function errorResponse(traceId: string, status: number, body: Record<string, unknown>) {
  incrementCounter("spctre.api.errors", 1, {
    "http.route": EVIDENCE_ROUTE,
    "http.response.status_code": status,
  });
  return withTraceId(Response.json({ ...body, meta: makeMeta(traceId) }, { status }), traceId);
}

async function handlePostApiEvidence(request: Request) {
  const traceId = extractTraceId(request);
  const startedAt = Date.now();

  return await withSpan(
    "api.evidence.ingest",
    { "spctre.request_id": traceId, "http.route": EVIDENCE_ROUTE },
    async (span) => {
      const delegated = await delegateToGoIngestor(request, traceId);
      if (delegated) return delegated;

      let payload: unknown;

      try {
        payload = await request.json();
      } catch {
        return errorResponse(traceId, 400, { error: "Request body must be JSON." });
      }

      const parsed = parseBody(EvidenceIngestSchema, payload);

      if (!parsed.ok) {
        return errorResponse(traceId, 400, { error: parsed.error, issues: parsed.issues });
      }

      const result = await ingestRuntimeEvidence({
        request,
        parsed: parsed.value,
        rawPayload: payload,
        startedAt,
      });

      if (result.spanAttributes) {
        span.setAttributes(result.spanAttributes);
      }

      for (const path of result.revalidatePaths ?? []) {
        revalidatePath(path);
      }

      return withTraceId(
        Response.json({ ...result.body, meta: makeMeta(traceId) }, { status: result.status }),
        traceId,
      );
    },
  );
}

export { handlePostApiEvidence as POST };
