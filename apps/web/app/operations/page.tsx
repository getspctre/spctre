import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function OperationsRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/operations", searchParams);
  return null;
}
