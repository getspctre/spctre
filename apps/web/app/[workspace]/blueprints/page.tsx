import { BlueprintsPageContent } from "../../blueprints/content";

export default async function WorkspaceBlueprintsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  return <BlueprintsPageContent workspaceSlug={workspace} />;
}
