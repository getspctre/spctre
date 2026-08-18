import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  // The control plane renders the complete corpus from apps/web/content/docs.
  // Pages is an OSS-only publication target built from a filtered copy.
  dir: ".generated-public-docs",
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

export default defineConfig();
