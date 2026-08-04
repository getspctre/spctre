import type { EvidenceSearchParams } from "./evidence-search";

export const dynamic = "force-dynamic";

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<EvidenceSearchParams>;
}) {
  const { redirectToWorkspace } = await import("@/lib/workspace/redirect-to-workspace");
  await redirectToWorkspace("/evidence", searchParams);
  return null;
}
