import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { SettingsHeader } from "@/components/settings-header";
import { listPublicationSigningKeys } from "@/lib/repositories/publication-attestations";
import { runWithTenantContext } from "@/lib/tenant-context";
import { getActiveScope } from "@/lib/workspace";
import { swallow } from "@/lib/platform/swallow";
import { SigningKeyManager } from "./signing-key-manager";

export const dynamic = "force-dynamic";

export default async function PublicationSigningKeysPage() {
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) redirect("/login");
  const workspace = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!workspace) redirect("/?error=workspace-unavailable");
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspace.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) redirect("/?error=admin-required");
  const keys = await runWithTenantContext(session.tenantId, () =>
    listPublicationSigningKeys({ tenantId: session.tenantId, workspaceId: workspace.workspaceId }),
  );
  return (
    <>
      <SettingsHeader
        eyebrow="Evidence"
        title="Publication signing keys"
        description="Manage ownership-verified keys used to sign publication attestations."
      />
      <SigningKeyManager keys={keys} />
    </>
  );
}
