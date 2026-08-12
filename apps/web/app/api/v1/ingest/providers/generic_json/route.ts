import {
  authorizeEvidenceIngest,
  error,
  handleGenericRecords,
  readJsonRecord,
} from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
import { withApiRoute } from "@/lib/platform/api-route";

export const dynamic = "force-dynamic";

const handlePostGenericJson = withApiRoute(
  "/api/v1/ingest/providers/generic_json",
  async (request) => {
    const authorization = await authorizeEvidenceIngest(request);
    if (authorization instanceof Response) return authorization;
    const payload = await readJsonRecord(request);
    return payload instanceof Response
      ? payload
      : handleGenericRecords({
          request,
          auth: authorization.auth,
          providerType: "generic_json",
          records: [payload],
        });
  },
);

export { handlePostGenericJson as POST };
