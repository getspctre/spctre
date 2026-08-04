import { BlueprintReviewContent } from "../../../blueprints/[id]/blueprint-review-content";

export default async function WorkspaceBlueprintReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; id: string }>;
  searchParams: Promise<{ rev?: string | string[] }>;
}) {
  const { workspace, id } = await params;
  const { rev } = await searchParams;
  return (
    <BlueprintReviewContent
      workspaceSlug={workspace}
      blueprintId={id}
      selectedRevisionId={Array.isArray(rev) ? rev[0] : rev}
    />
  );
}
