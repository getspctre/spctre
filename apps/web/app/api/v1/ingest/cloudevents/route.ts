import { error, handleGenericRecords, readJsonRecord } from "@/app/api/ingest/_shared";
import { extractTraceId } from "@spctre/api-contracts";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const payload = await readJsonRecord(request);
  if (payload instanceof Response)
    return error("CloudEvent body must be a JSON object.", 400, extractTraceId(request));
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
  return handleGenericRecords({ request, providerType: "cloudevents", records: [record] });
}
