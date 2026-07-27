import { RulesInventoryPageContent } from "../../rules/content";

export default async function WorkspaceRulesInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { workspace } = await params;
  return <RulesInventoryPageContent workspaceSlug={workspace} searchParams={searchParams} />;
}
