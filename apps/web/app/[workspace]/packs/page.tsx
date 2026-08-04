import { PacksPageContent } from "../../packs/content";

export default async function WorkspacePacksPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  return <PacksPageContent workspaceSlug={workspace} />;
}
