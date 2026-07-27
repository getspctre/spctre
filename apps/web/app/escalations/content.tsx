import {
  listGatewayEscalationQueue,
  type OpenEscalationQueue,
} from "@/lib/domains/gateway/service";
import { getActiveActor } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { EscalationQueueView } from "./escalation-queue-view";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { QuickStartBanner } from "../quick-start-banner";

export async function EscalationsPageContent({ workspaceSlug }: { workspaceSlug?: string } = {}) {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const appViewMode = await getAppViewMode();
  const hasManagedHitl = isFeatureEnabled("slaTrackedHitlQueue");
  const crossSurfaceIdentity = isFeatureEnabled("crossSurfaceAgentIdentity");
  const eyebrow = formatWorkspaceEyebrow(workspaceContext);
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });

  let queue: OpenEscalationQueue = [];
  let actors: Array<{ id: string; name: string; email: string | null; reviewerRoles: string[] }> = [];
  try {
    const [openQueue, activeActor] = await Promise.all([
      listGatewayEscalationQueue({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
        limit: 100,
      }),
      getActiveActor({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
      }),
    ]);
    queue = openQueue;
    actors = activeActor.actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      reviewerRoles: actor.reviewerRoles,
    }));
  } catch {
    // DB not available
  }

  return (
    <EscalationQueueView
      initialQueue={queue}
      actors={actors}
      hasManagedHitl={hasManagedHitl}
      crossSurfaceIdentity={crossSurfaceIdentity}
      appViewMode={appViewMode}
      workspaceEyebrow={eyebrow}
      onboardingBanner={
        onboardingStatus.realEvidenceCount === 0 ? (
          <QuickStartBanner
            controlPlaneUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev"}
            status={onboardingStatus}
            surface="escalations"
            workspaceSlug={workspaceContext.workspaceSlug}
          />
        ) : null
      }
    />
  );
}
