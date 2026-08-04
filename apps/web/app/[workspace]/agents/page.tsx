import { AgentsPageContent } from "../../agents/content";

export default async function WorkspaceAgentsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  return <AgentsPageContent workspaceSlug={workspace} />;
}
