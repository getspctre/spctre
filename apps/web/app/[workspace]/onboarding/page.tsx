import { QuickStartBanner } from "../../quick-start-banner";
import { getWorkspaceContext } from "@/lib/workspace";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";

export default async function WorkspaceOnboardingPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: workspace });
  const status = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });
  const controlPlaneUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev";

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspaceContext)}</p>
          <h1>Try governance</h1>
        </div>
      </section>
      <QuickStartBanner
        controlPlaneUrl={controlPlaneUrl}
        status={status}
        workspaceSlug={workspaceContext.workspaceSlug}
      />
    </>
  );
}
