import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

export function GET() {
  const text = llms(source).index();
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
