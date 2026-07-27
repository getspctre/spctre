import { SPCTRE_OPENAPI_SPEC } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

function handleGetApiV1OpenapiJson() {
  return new Response(JSON.stringify(SPCTRE_OPENAPI_SPEC, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

export { handleGetApiV1OpenapiJson as GET };
