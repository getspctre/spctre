import { redirectToWorkspace } from "@/lib/workspace/redirect-to-workspace";

export default async function ComplianceDeliveryRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToWorkspace("/compliance/delivery", searchParams);
  return null;
}
