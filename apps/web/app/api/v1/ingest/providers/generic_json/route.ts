import {
  enforceEvidenceRateLimit,
  error,
  handleGenericRecords,
  readJsonRecord,
} from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const throttle = await enforceEvidenceRateLimit(request);
  if (throttle) return throttle;
  const payload = await readJsonRecord(request);
  return payload instanceof Response
    ? error("Request body must be a JSON object.", 400, extractTraceId(request))
    : handleGenericRecords({ request, providerType: "generic_json", records: [payload] });
}
