import { type FeatureFlag } from "@/lib/feature-flags";
import { getAuthSession } from "@/lib/auth-session";
import { isFeatureEntitled } from "@/lib/entitlements/features";
import { UpgradePrompt } from "./upgrade-prompt";

/**
 * Server component. It resolves the viewer's tenant itself rather than taking
 * one as a prop, so a page cannot gate on a feature while forgetting to say
 * whose entitlement it is asking about — the omission would have silently
 * granted the deployment's own plan to every viewer.
 */
export async function PlanGate({
  children,
  feature,
  fallback,
  prompt = "panel",
}: {
  children: React.ReactNode;
  feature: FeatureFlag;
  fallback?: React.ReactNode;
  prompt?: "panel" | "inline" | "none";
}) {
  const session = await getAuthSession();
  if (await isFeatureEntitled(feature, session?.tenantId ?? null)) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  if (prompt === "none") return null;
  return <UpgradePrompt feature={feature} variant={prompt} />;
}
