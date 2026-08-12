import {
  authorizeEvidenceIngest,
  handleGenericRecords,
  readJsonRecord,
} from "@/app/api/ingest/_shared";
import { isRecord } from "@/lib/records";
import { withApiRoute } from "@/lib/platform/api-route";
export const dynamic = "force-dynamic";
const handlePostOtlpLogs = withApiRoute("/api/v1/logs", async (request, ctx) => {
  const authorization = await authorizeEvidenceIngest(request);
  if (authorization instanceof Response) return authorization;
  const payload = await readJsonRecord(request);
  if (payload instanceof Response) return payload;
  const records: Record<string, unknown>[] = [];
  for (const resourceLog of Array.isArray(payload.resourceLogs) ? payload.resourceLogs : []) {
    if (!isRecord(resourceLog)) continue;
    for (const scopeLog of Array.isArray(resourceLog.scopeLogs) ? resourceLog.scopeLogs : []) {
      if (!isRecord(scopeLog)) continue;
      for (const logRecord of Array.isArray(scopeLog.logRecords) ? scopeLog.logRecords : [])
        if (isRecord(logRecord))
          records.push({
            ...logRecord,
            resource: resourceLog.resource ?? {},
            scope: scopeLog.scope ?? {},
          });
    }
  }
  return records.length
    ? handleGenericRecords({
        request,
        auth: authorization.auth,
        providerType: "otlp_logs",
        records,
      })
    : ctx.error(400, "OTLP payload contains no log records.");
});

export { handlePostOtlpLogs as POST };
