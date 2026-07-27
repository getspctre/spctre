import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/lib/workspace";

/**
 * If the active workspace has a slug, redirects to the canonical
 * /[workspace]/path form, optionally preserving query parameters.
 * Call at the top of bare-route default exports.
 * `redirect()` throws internally so the calling function never continues.
 */
export async function redirectToWorkspace(
  path: string,
  searchParams?: Promise<Record<string, string | string[] | undefined>>
): Promise<void> {
  const ctx = await getWorkspaceContext().catch(() => null);
  if (ctx?.workspaceSlug) {
    let queryString = "";
    if (searchParams) {
      const resolved = await searchParams;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(resolved)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach((v) => params.append(key, String(v)));
          } else {
            params.append(key, String(value));
          }
        }
      }
      const str = params.toString();
      if (str) {
        queryString = `?${str}`;
      }
    }
    redirect(`/${ctx.workspaceSlug}${path}${queryString}`);
  }
}
