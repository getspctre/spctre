import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

// `index()` returns a promise as of fumadocs-core 16.15.9; it was synchronous
// before, and an unawaited promise here serves the string "[object Promise]".
export async function GET() {
  const text = await llms(source).index();
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
