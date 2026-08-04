import { getAlertingPageModel } from "@/lib/domains/alerting/service";
import { PlanGate } from "@/app/plan-gate";
import { SettingsHeader } from "@/components/settings-header";
import { EscalationRoutingClient } from "./escalation-routing-client";

export default async function EscalationRoutingPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const { workspaceContext, integrations, rules } = await getAlertingPageModel({
    workspaceSlug: workspace,
  });
  return (
    <>
      <SettingsHeader
        eyebrow="Governance operations"
        title="Escalation routing"
        description="Route policy violations and escalation work to accountable reviewers."
      />
      <PlanGate feature="managedWorkflowEnforcement">
        <EscalationRoutingClient
          workspaceId={workspaceContext.workspaceId}
          workspaceSlug={workspaceContext.workspaceSlug}
          integrations={integrations}
          rules={rules}
        />
      </PlanGate>
    </>
  );
}
