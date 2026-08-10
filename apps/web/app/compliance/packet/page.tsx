import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function CompliancePacketRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/compliance/packet", searchParams);
  return null;
}
