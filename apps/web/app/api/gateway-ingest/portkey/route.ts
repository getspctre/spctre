import { normalizePortkeyEvent } from "@/lib/domains/gateway/ingest";
import { handleRegisteredGatewayIngest } from "../_shared";

export const dynamic = "force-dynamic";

async function handlePostApiGatewayIngestPortkey(request: Request) {
  return handleRegisteredGatewayIngest({
    request,
    provider: "portkey",
    providerHeader: "x-portkey-webhook-secret",
    route: "/api/gateway-ingest/portkey",
    spanName: "api.gateway-ingest.portkey",
    defaultPrincipalId: "gateway:portkey",
    invalidPayloadMessage: "Could not parse Portkey event — missing required field 'id'.",
    normalize: normalizePortkeyEvent,
    getEnvironment: (raw, request) =>
      String(
        (raw.metadata as Record<string, unknown> | undefined)?.environment ??
          request.headers.get("x-spctre-environment") ??
          "production",
      ),
  });
}

export { handlePostApiGatewayIngestPortkey as POST };
