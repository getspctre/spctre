import {
  authorizeEvidenceIngest,
  error,
  handleGenericRecords,
  readBoundedText,
} from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
import { logger } from "@spctre/platform/logging";
import { withApiRoute } from "@/lib/platform/api-route";
import { isRecord } from "@/lib/records";

export const dynamic = "force-dynamic";

const handlePostGenericNdjson = withApiRoute(
  "/api/v1/ingest/providers/generic_ndjson",
  async (request) => {
    const authorization = await authorizeEvidenceIngest(request);
    if (authorization instanceof Response) return authorization;
    const body = await readBoundedText(request);
    if (body instanceof Response)
      return error("Request body exceeds the 1 MiB limit.", 413, extractTraceId(request));
    const records = body
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          const value: unknown = JSON.parse(line);
          return isRecord(value) ? value : { error: "NDJSON lines must be JSON objects." };
        } catch (caught) {
          logger.warn("Malformed generic NDJSON record", {
            error: caught instanceof Error ? caught.message : String(caught),
          });
          return { error: "Malformed NDJSON line." };
        }
      });
    return records.length
      ? handleGenericRecords({
          request,
          auth: authorization.auth,
          providerType: "generic_ndjson",
          records,
        })
      : error(
          "Request body must contain at least one NDJSON record.",
          400,
          extractTraceId(request),
        );
  },
);

export { handlePostGenericNdjson as POST };
