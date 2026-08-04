"use server";

import { revalidatePath } from "next/cache";
import { getAuthSession } from "@/lib/auth-session";
import { requestUsageBillingCommercialReview } from "@/lib/domains/usage-billing/service";
import { getWorkspaceContext } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { isDemoTenant } from "@/lib/demo-guard";
import { swallow } from "@/lib/platform/swallow";

const VALID_TARGET_PLANS = new Set(["TEAM", "BUSINESS", "ENTERPRISE"]);

export async function requestUsageBillingReview(formData: FormData): Promise<void> {
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "").trim();
  const targetPlan = String(formData.get("targetPlan") ?? "BUSINESS")
    .trim()
    .toUpperCase();
  const note = String(formData.get("note") ?? "")
    .trim()
    .slice(0, 500);

  if (!VALID_TARGET_PLANS.has(targetPlan)) return;

  const [workspaceContext, session] = await Promise.all([
    getWorkspaceContext({ workspaceSlug: workspaceSlug || undefined }),
    getAuthSession().catch(swallow("getAuthSession", null)),
  ]);
  if (!session) return;
  if (isDemoTenant(workspaceContext.tenantId)) return;

  await requestUsageBillingCommercialReview({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
    principalId: session.principalId,
    targetPlan,
    note,
    workspaceSlug: workspaceContext.workspaceSlug,
    requestedBy: session.email ?? session.subject,
  });

  revalidatePath(buildWorkspacePath(workspaceContext.workspaceSlug, "/usage-billing"));
  revalidatePath("/usage-billing");
}
