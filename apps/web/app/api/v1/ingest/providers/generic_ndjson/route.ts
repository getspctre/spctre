import { error, handleGenericRecords, isJsonRecord, readBoundedText } from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
import { logger } from "@spctre/platform/logging";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const body = await readBoundedText(request);
  if (body instanceof Response)
    return error("Request body exceeds the 1 MiB limit.", 413, extractTraceId(request));
  const records = body
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return isJsonRecord(value) ? value : { error: "NDJSON lines must be JSON objects." };
      } catch (caught) {
        logger.warn("Malformed generic NDJSON record", {
          error: caught instanceof Error ? caught.message : String(caught),
        });
        return { error: "Malformed NDJSON line." };
      }
    });
  return records.length
    ? handleGenericRecords({ request, providerType: "generic_ndjson", records })
    : error("Request body must contain at least one NDJSON record.", 400, extractTraceId(request));
}
