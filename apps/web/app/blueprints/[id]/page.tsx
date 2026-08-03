import { BlueprintReviewContent } from "./blueprint-review-content";

export default async function BlueprintReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rev?: string | string[] }>;
}) {
  const { id } = await params;
  const { rev } = await searchParams;
  return <BlueprintReviewContent blueprintId={id} selectedRevisionId={Array.isArray(rev) ? rev[0] : rev} />;
}
