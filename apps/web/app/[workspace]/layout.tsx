import { notFound } from "next/navigation";
import { getWorkspaceContext } from "@/lib/workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const context = await getWorkspaceContext({ workspaceSlug: workspace });
  if (context.workspaceSlug !== workspace) notFound();
  return children;
}
