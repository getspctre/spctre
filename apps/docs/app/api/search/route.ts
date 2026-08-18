import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Emit the search index during static export. The browser-side static client
// loads this file instead of calling a server route on GitHub Pages.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
