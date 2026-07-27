import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function PoliciesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("", searchParams);
  return null;
}
