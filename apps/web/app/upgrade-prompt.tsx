// Presentation only, and deliberately separate from PlanGate.
//
// A client component renders this prompt, while PlanGate resolves the
// viewer's tenant through the database. Keeping them in one module made
// every client importer pull the tenant-context chain — and `async_hooks`
// with it — into the browser bundle, which fails the web build rather than
// failing at runtime.
import { LockKeyhole } from "lucide-react";
import { FEATURE_FLAGS, type FeatureFlag } from "@/lib/feature-flags";

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
