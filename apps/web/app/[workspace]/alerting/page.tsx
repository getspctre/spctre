import { redirect } from "next/navigation";

export default async function WorkspaceAlertingPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  redirect(`/${workspace}/escalation-routing`);
}
