import { LockKeyhole } from "lucide-react";
import { FEATURE_FLAGS, type FeatureFlag } from "@/lib/feature-flags";
import { isFeatureEnabled } from "@/lib/feature-flags-server";

export function PlanGate({
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
  if (isFeatureEnabled(feature)) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  if (prompt === "none") return null;
  return <UpgradePrompt feature={feature} variant={prompt} />;
}

export function UpgradePrompt({
  feature,
  variant = "panel",
}: {
  feature: FeatureFlag;
  variant?: "panel" | "inline";
}) {
  const definition = FEATURE_FLAGS[feature];
  return (
    <div className={variant === "inline" ? "upgradePrompt upgradePromptInline" : "upgradePrompt"}>
      <LockKeyhole size={16} />
      <div>
        <p className="eyebrow">{definition.minimumPlan} plan</p>
        <h3>{definition.label}</h3>
        <p className="meta">{definition.description}</p>
      </div>
      <a className="button" href="/usage-billing">
        View plans
      </a>
    </div>
  );
}
