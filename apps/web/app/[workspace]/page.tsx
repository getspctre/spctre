import { PoliciesPageContent } from "../policies-page-content";

export default async function WorkspacePoliciesPage({
  params,
  searchParams
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await params;
  return <PoliciesPageContent workspaceSlug={workspace} searchParams={searchParams} />;
}
