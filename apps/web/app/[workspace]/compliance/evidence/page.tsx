import { CompliancePageContent } from "../../../compliance/content";

export default async function WorkspaceComplianceEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await params;
  return (
    <CompliancePageContent workspaceSlug={workspace} searchParams={searchParams} view="evidence" />
  );
}
