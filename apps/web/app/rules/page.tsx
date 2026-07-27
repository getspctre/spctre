import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function RulesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/rules", searchParams);
  return null;
}
