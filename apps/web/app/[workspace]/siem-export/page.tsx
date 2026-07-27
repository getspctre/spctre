import { getSiemStreamPageModel } from "@/lib/domains/siem-stream/service";
import { PlanGate } from "@/app/plan-gate";
import { SettingsHeader } from "@/components/settings-header";
import { SiemExportClient } from "./siem-export-client";

export default async function SiemExportPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { workspaceContext, streams } = await getSiemStreamPageModel({ workspaceSlug: workspace });
  return <><SettingsHeader eyebrow="Governance operations" title="SIEM export" description="Forward governed runtime evidence to Splunk HEC or Microsoft Sentinel." /><PlanGate feature="managedWorkflowEnforcement"><SiemExportClient workspaceId={workspaceContext.workspaceId} workspaceSlug={workspaceContext.workspaceSlug} streams={streams} /></PlanGate></>;
}
