import {
  authorizeEvidenceIngest,
  error,
  handleGenericRecords,
  readJsonRecord,
} from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
import { withApiRoute } from "@/lib/platform/api-route";

export const dynamic = "force-dynamic";

const handlePostCloudEvents = withApiRoute("/api/v1/ingest/cloudevents", async (request) => {
  const authorization = await authorizeEvidenceIngest(request);
  if (authorization instanceof Response) return authorization;
  const payload = await readJsonRecord(request);
  if (payload instanceof Response) return payload;
  const type = request.headers.get("ce-type");
  if (!type && (!payload.specversion || !payload.type || !payload.source))
    return error(
      "CloudEvent must use structured mode or include ce-type headers.",
      400,
      extractTraceId(request),
    );
  const record = type
    ? {
        ...payload,
        _cloudevents: Object.fromEntries(
          [...request.headers].filter(([key]) => key.startsWith("ce-")),
        ),
      }
    : payload;
  return handleGenericRecords({
    request,
    auth: authorization.auth,
    providerType: "cloudevents",
    records: [record],
  });
});

export { handlePostCloudEvents as POST };
