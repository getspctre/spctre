import { hitlService } from "@/lib/ee-adapters/hitl";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { listHitlTenants, listHitlTenantWorkspaces } from "@/lib/domains/admin/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return Response.json(
      { error: "Managed HITL background worker requires a commercial plan." },
      { status: 403 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const workerSecret = process.env.HITL_WORKER_SECRET;
  if (!workerSecret || authHeader !== `Bearer ${workerSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    // 1. Fetch all active tenants via repository
    const tenants = await listHitlTenants();

    const summary = {
      tenantsProcessed: tenants.length,
      workspacesProcessed: 0,
      breachesDetected: 0,
      notificationsDispatched: 0,
      logs: [] as string[],
    };

    // 2. Scan each tenant for workspace-specific escalations
    for (const tenant of tenants) {
      const workspaces = await listHitlTenantWorkspaces(tenant.id);

      for (const workspace of workspaces) {
        summary.workspacesProcessed++;

        // 3. Scan for active SLA breaches
        const breaches = await hitlService.checkSlaBreaches(workspace.id, tenant.id);

        for (const breach of breaches) {
          summary.breachesDetected++;

          // 4. Trigger auto-reassignment and notify PagerDuty/Slack alerting integrations
          try {
            await hitlService.notifyOnBreach(breach);
            summary.notificationsDispatched++;
            summary.logs.push(
              `[SUCCESS] SLA Breach for decision ${breach.decisionId} processed in workspace ${workspace.name}`,
            );
          } catch (err) {
            summary.logs.push(
              `[ERROR] Failed to notify breach for decision ${breach.decisionId}: ${(err as Error).message}`,
            );
          }
        }
      }
    }

    return Response.json({
      status: "OK",
      message: "Managed HITL SLA monitoring sweep complete.",
      summary,
    });
  } catch (err) {
    console.error("[HITL Worker Error]", err);
    return Response.json(
      { error: "SLA sweep failed.", detail: (err as Error).message },
      { status: 500 },
    );
  }
}
