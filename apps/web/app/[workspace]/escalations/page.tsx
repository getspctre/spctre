import { EscalationsPageContent } from "../../escalations/content";

export default async function WorkspaceEscalationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  return <EscalationsPageContent workspaceSlug={workspace} />;
}
