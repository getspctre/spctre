import { UsageBillingPageContent } from "../../usage-billing/content";

export default async function WorkspaceUsageBillingPage({
  params
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  return <UsageBillingPageContent workspaceSlug={workspace} />;
}
