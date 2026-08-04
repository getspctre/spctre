export default async function AlertingPage({
  searchParams,
}: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { redirectToWorkspace } = await import("@/lib/workspace/redirect-to-workspace");
  await redirectToWorkspace("/escalation-routing", searchParams);
  return null;
}
