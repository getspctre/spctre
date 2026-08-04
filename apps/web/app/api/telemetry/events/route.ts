import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handlePostApiTelemetryEvents(request: Request) {
  const traceId = extractTraceId(request);
  return withTraceId(
    Response.json(
      {
        error: "This public telemetry endpoint has been retired.",
        message:
          "Conversion and billing lifecycle events are now recorded server-side. Use authenticated product flows or the signed Paddle billing webhook.",
        migration: {
          billingWebhook: "/api/billing/paddle/webhook",
          replacement: "server-side conversion telemetry",
        },
        meta: makeMeta(traceId),
      },
      { status: 410 },
    ),
    traceId,
  );
}

export { handlePostApiTelemetryEvents as POST };
