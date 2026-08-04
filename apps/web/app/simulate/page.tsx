export default async function SimulatePage({
  searchParams,
}: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { redirectToWorkspace } = await import("@/lib/workspace/redirect-to-workspace");
  await redirectToWorkspace("/simulate", searchParams);
  return null;
}
