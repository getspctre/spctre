import {
  enforceEvidenceRateLimit,
  error,
  handleGenericRecords,
  readJsonRecord,
} from "@/app/api/ingest/_shared";
import {
  normalizeManagedProviderEvent,
  type ManagedProvider,
} from "@/lib/domains/evidence/managed-adapters";
import { extractTraceId } from "@spctre/api-contracts";
import { withApiRoute } from "@/lib/platform/api-route";

export const dynamic = "force-dynamic";
const providers = new Set<ManagedProvider>([
  "bedrock_agentcore",
  "docker_ai_governance",
  "langsmith",
]);

const handlePostManagedProvider = withApiRoute<{ params: Promise<{ provider: string }> }>(
  "/api/v1/ingest/providers/[provider]",
  async (request, _ctx, context) => {
    const throttle = await enforceEvidenceRateLimit(request);
    if (throttle) return throttle;
    const { provider } = await context.params;
    const traceId = extractTraceId(request);
    if (!providers.has(provider as ManagedProvider))
      return error("Unknown managed evidence provider.", 404, traceId);
    const payload = await readJsonRecord(request);
    if (payload instanceof Response)
      return error("Request body must be a JSON object.", 400, traceId);
    return handleGenericRecords({
      request,
      providerType: provider as ManagedProvider,
      records: [normalizeManagedProviderEvent(provider as ManagedProvider, payload)],
    });
  },
);

export { handlePostManagedProvider as POST };
