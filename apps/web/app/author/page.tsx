import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function AuthorRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/author", searchParams);
  return null;
}
