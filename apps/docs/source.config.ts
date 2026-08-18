import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  // The control-plane help route and GitHub Pages intentionally compile the
  // same source material. Pages is a publication target, not a second manual.
  dir: "../web/content/docs",
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

export default defineConfig();
