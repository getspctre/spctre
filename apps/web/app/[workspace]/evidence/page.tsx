import { EvidencePageContent } from "../../evidence/evidence-page-content";

type EvidenceSearchParams = Record<string, string | string[] | undefined>;

export default async function WorkspaceEvidencePage({
  params,
  searchParams
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<EvidenceSearchParams>;
}) {
  const { workspace } = await params;
  return <EvidencePageContent workspaceSlug={workspace} searchParams={searchParams} />;
}
