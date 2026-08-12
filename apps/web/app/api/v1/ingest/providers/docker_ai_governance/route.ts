import {
  enforceEvidenceRateLimit,
  error,
  handleGenericRecords,
  readBoundedText,
} from "@/app/api/ingest/_shared";
import { normalizeManagedProviderEvent } from "@/lib/domains/evidence/managed-adapters";
import { withApiRoute } from "@/lib/platform/api-route";
import { isRecord } from "@/lib/records";
import { reportSwallowedError } from "@/lib/platform/swallow";
import { extractTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

// Docker AI Governance writes completed audit files as JSONL. This concrete
// route intentionally shadows the generic managed-provider route so a shipper
// can send a sealed file in one bounded request while JSON callers remain
// compatible with the one-record managed-provider contract.
const handlePostDockerAiGovernance = withApiRoute(
  "/api/v1/ingest/providers/docker_ai_governance",
  async (request) => {
    const throttle = await enforceEvidenceRateLimit(request);
    if (throttle) return throttle;
    const traceId = extractTraceId(request);
    const body = await readBoundedText(request);
    if (body instanceof Response)
      return error("Request body exceeds the 1 MiB limit.", 413, traceId);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const lines =
      contentType.includes("ndjson") || contentType.includes("jsonl")
        ? body.split(/\r?\n/).filter(Boolean)
        : [body];
    if (!lines.length || !lines[0]?.trim())
      return error("Request body must contain at least one Docker audit event.", 400, traceId);
    const records = lines.map((line) => {
      try {
        const raw: unknown = JSON.parse(line);
        return isRecord(raw)
          ? normalizeManagedProviderEvent("docker_ai_governance", raw)
          : { error: "Docker audit events must be JSON objects." };
      } catch (error) {
        reportSwallowedError("dockerAiGovernanceIngest.parseLine", error);
        return { error: "Malformed Docker audit JSON line." };
      }
    });
    return handleGenericRecords({ request, providerType: "docker_ai_governance", records });
  },
);

export { handlePostDockerAiGovernance as POST };
