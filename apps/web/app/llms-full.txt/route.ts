import { docs } from "@/.source/server";

export const revalidate = false;

export async function GET() {
  const sections = await Promise.all(
    docs.docs.map(async (page) => {
      const text = await page.getText("processed");
      const title = page.title ?? page.info.path;
      return `# ${title}\n\nURL: /help-docs/${page.info.path}\n\n${text}`;
    }),
  );

  return new Response(sections.join("\n\n---\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
