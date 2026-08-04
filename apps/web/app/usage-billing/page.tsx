import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function UsageBillingRedirectPage({
  searchParams,
}: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  await redirectToWorkspace("/usage-billing", searchParams);
  return null;
}
