import { ApiReference } from "@scalar/nextjs-api-reference";

const handleGetApiDocs = ApiReference({
  spec: { url: "/api/v1/openapi.json" },
  theme: "purple",
  defaultHttpClient: {
    targetKey: "javascript",
    clientKey: "fetch",
  },
  hideDownloadButton: false,
  metaData: {
    title: "Spctre API Reference",
    description: "OpenAPI 3.1 reference for the Spctre public API",
  },
});

export { handleGetApiDocs as GET };
