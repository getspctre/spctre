import { AuthorPageContent } from "../../author/content";

export default async function WorkspaceAuthorPage({
  params,
  searchParams
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { workspace } = await params;
  return <AuthorPageContent workspaceSlug={workspace} searchParams={searchParams} />;
}
