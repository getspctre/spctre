import {
  error,
  enforceEvidenceRateLimit,
  handleGenericRecords,
  isJsonRecord,
  readJsonRecord,
} from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const throttle = await enforceEvidenceRateLimit(request);
  if (throttle) return throttle;
  const payload = await readJsonRecord(request);
  if (payload instanceof Response)
    return error("OTLP/HTTP logs must use JSON encoding.", 400, extractTraceId(request));
  const records: Record<string, unknown>[] = [];
  for (const resourceLog of Array.isArray(payload.resourceLogs) ? payload.resourceLogs : []) {
    if (!isJsonRecord(resourceLog)) continue;
    for (const scopeLog of Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : []) {
      if (!isJsonRecord(scopeLog)) continue;
      for (const logRecord of Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : [])
        if (isJsonRecord(logRecord))
          records.push({
            ...logRecord,
            resource: resourceLog.resource ?? {},
            scope: scopeLog.scope ?? {},
          });
    }
  }
  return records.length
    ? handleGenericRecords({ request, providerType: "otlp_logs", records })
    : error("OTLP payload contains no log records.", 400, extractTraceId(request));
}
