import {
  listGatewayEscalationQueue,
  type OpenEscalationQueue,
} from "@/lib/domains/gateway/service";
import { getActiveActor } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { getEntitledFeatureFlags } from "@/lib/entitlements/features";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { EscalationQueueView } from "./escalation-queue-view";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { reportSwallowedError } from "@/lib/platform/swallow";
import { QuickStartBanner } from "../quick-start-banner";

export async function EscalationsPageContent({ workspaceSlug }: { workspaceSlug?: string } = {}) {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const appViewMode = await getAppViewMode();
  // One resolution for both flags: the per-flag call reads the plan code each
  // time, and this page gates on two.
  const features = await getEntitledFeatureFlags(workspaceContext.tenantId);
  const hasManagedHitl = features.slaTrackedHitlQueue;
  const crossSurfaceIdentity = features.crossSurfaceAgentIdentity;
  const eyebrow = formatWorkspaceEyebrow(workspaceContext);
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });

  let queue: OpenEscalationQueue = [];
  let actors: Array<{ id: string; name: string; email: string | null; reviewerRoles: string[] }> =
    [];
  let loadFailed = false;
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
  } catch (error) {
    // The queue read no longer degrades in the repository, so this is a real
    // failure: an unreachable database, or a broken query. Rendering the
    // "Queue is clear" empty state here would tell a reviewer there is nothing
    // to action, which is the opposite of what a failed read means.
    reportSwallowedError("EscalationsPageContent", error);
    loadFailed = true;
  }

  return (
    <EscalationQueueView
      initialQueue={queue}
      initialLoadFailed={loadFailed}
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
