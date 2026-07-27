import { normalizeLitellmEvent } from "@/lib/domains/gateway/ingest";
import { handleRegisteredGatewayIngest } from "../_shared";

export const dynamic = "force-dynamic";

async function handlePostApiGatewayIngestLitellm(request: Request) {
  return handleRegisteredGatewayIngest({
    request,
    provider: "litellm",
    providerHeader: "x-litellm-signature",
    route: "/api/gateway-ingest/litellm",
    spanName: "api.gateway-ingest.litellm",
    defaultPrincipalId: "gateway:litellm",
    invalidPayloadMessage: "Could not parse LiteLLM event — missing required field 'id' or 'call_id'.",
    normalize: normalizeLitellmEvent,
    getEnvironment: (raw, request) => {
      const metadata = (raw.metadata as Record<string, unknown> | undefined) ?? {};
      const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]) : [];
      return tags.find((t) => ["production", "staging", "development"].includes(t)) ??
        String(request.headers.get("x-spctre-environment") ?? "production");
    },
  });
}

export { handlePostApiGatewayIngestLitellm as POST };
