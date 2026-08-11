import { redirect } from "next/navigation";
import { SettingsHeader } from "@/components/settings-header";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { getActiveScope } from "@/lib/workspace";
import {
  getEvidenceIntegrations,
  getGenericEvidenceCoverageModel,
  getGenericEvidenceProvenance,
} from "@/lib/domains/evidence/integration-service";
import { swallow } from "@/lib/platform/swallow";
import { EvidenceIntegrationWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function EvidenceIntegrationsPage() {
  const scope = await getActiveScope();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) redirect("/login");
  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) redirect("/?error=admin-required");
  const integrations = await getEvidenceIntegrations({
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  });
  const provenance = await getGenericEvidenceProvenance({
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  });
  const coverage = await getGenericEvidenceCoverageModel({
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  });
  return (
    <>
      <SettingsHeader
        eyebrow="Evidence ingress"
        title="Evidence integrations"
        description="Configure source evidence, inspect mapping revisions, and retain defensible provenance."
      />
      <EvidenceIntegrationWizard
        integrations={integrations}
        provenance={provenance}
        coverage={coverage}
      />
    </>
  );
}
