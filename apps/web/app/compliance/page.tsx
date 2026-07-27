import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function ComplianceRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/compliance", searchParams);
  return null;
}
