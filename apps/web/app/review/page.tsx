import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function ReviewRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/review", searchParams);
  return null;
}
