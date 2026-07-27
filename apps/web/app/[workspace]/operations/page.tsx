import { OperationsPageContent } from "../../operations/content";

export default async function WorkspaceOperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams?: Promise<Record<string, string>>;
}) {
  const { workspace } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  return <OperationsPageContent workspaceSlug={workspace} searchParams={resolvedSearchParams} />;
}
