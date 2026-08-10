import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function ComplianceEvidenceRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/compliance/evidence", searchParams);
  return null;
}
