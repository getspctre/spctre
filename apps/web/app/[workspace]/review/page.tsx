import { ReviewPageContent } from "../../review/content";

export default async function WorkspaceReviewPage({
  params,
  searchParams
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{
    branch?: string | string[];
    stage?: string | string[];
    reviewTab?: string | string[];
    publishTab?: string | string[];
  }>;
}) {
  const { workspace } = await params;
  return <ReviewPageContent workspaceSlug={workspace} searchParams={searchParams} />;
}
