import { normalizeHeliconeEvent } from "@/lib/domains/gateway/ingest";
import { handleRegisteredGatewayIngest } from "../_shared";

export const dynamic = "force-dynamic";

async function handlePostApiGatewayIngestHelicone(request: Request) {
  return handleRegisteredGatewayIngest({
    request,
    provider: "helicone",
    providerHeader: "helicone-signature",
    route: "/api/gateway-ingest/helicone",
    spanName: "api.gateway-ingest.helicone",
    defaultPrincipalId: "gateway:helicone",
    invalidPayloadMessage: "Could not parse Helicone event — missing required field 'id'.",
    normalize: normalizeHeliconeEvent,
    getEnvironment: (raw, request) => {
      const data = (raw.data as Record<string, unknown> | undefined) ?? raw;
      return String(
        (data.properties as Record<string, unknown> | undefined)?.environment ??
        request.headers.get("x-spctre-environment") ??
        "production"
      );
    },
  });
}

export { handlePostApiGatewayIngestHelicone as POST };
