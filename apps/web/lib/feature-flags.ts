export type SpctrePlan = "oss" | "cloud" | "business" | "enterprise";

export type FeatureFlag =
  | "multiTenantWorkspaceIsolation"
  | "samlScimProvisioning"
  | "slaTrackedHitlQueue"
  | "longTermForensicArchival"
  | "compliancePdfExport"
  | "bulkProductionSimulation"
  | "enterpriseRbacAudit"
  | "managedWorkflowEnforcement"
  | "siemEventStreaming"
  | "crossSurfaceAgentIdentity";

export interface FeatureFlagDefinition {
  label: string;
  minimumPlan: SpctrePlan;
  description: string;
}

const planRank: Record<SpctrePlan, number> = { oss: 0, cloud: 1, business: 2, enterprise: 3 };

/**
 * The lower of two plans by capability rank.
 *
 * Entitlement is the intersection of what a deployment is licensed to run and
 * what a tenant bought, and neither alone is the answer: a hosted deployment
 * runs at the highest plan it sells, so reading its plan as every tenant's
 * entitlement hands a trial account the whole catalog.
 */
export function lowerPlanOf(a: SpctrePlan, b: SpctrePlan): SpctrePlan {
  return planRank[a] <= planRank[b] ? a : b;
}

export const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlagDefinition> = {
  multiTenantWorkspaceIsolation: {
    label: "Multi-tenant workspace isolation",
    minimumPlan: "enterprise",
    description: "Attribute-aware workspace access controls across tenants and workspaces.",
  },
  samlScimProvisioning: {
    label: "SAML and SCIM provisioning",
    minimumPlan: "enterprise",
    description: "Enterprise identity provider setup and automated user provisioning.",
  },
  slaTrackedHitlQueue: {
    label: "SLA-tracked HITL queue",
    minimumPlan: "cloud",
    description: "Managed assignment, SLA timers, and reviewer triage for escalations.",
  },
  longTermForensicArchival: {
    label: "Long-term forensic archival",
    minimumPlan: "cloud",
    description: "Extended tamper-evident evidence retention beyond the OSS local store.",
  },
  compliancePdfExport: {
    label: "Compliance PDF export",
    minimumPlan: "business",
    description: "Auditor-ready PDF compliance packet generation.",
  },
  bulkProductionSimulation: {
    label: "Bulk production simulation",
    // Business, not Cloud. Replaying a proposed policy against the full
    // retained production log is the compliance workflow the published pricing
    // model sells as the Team -> Business boundary; Team keeps simulation
    // against sample events. The minimum said "cloud" for as long as nothing
    // read it per tenant, so the disagreement cost nothing and stayed.
    minimumPlan: "business",
    description: "What-if policy analysis across the full retained production event log.",
  },
  enterpriseRbacAudit: {
    label: "Custom roles and granular grants",
    minimumPlan: "enterprise",
    description:
      "Granular reviewer lanes, publish scopes, environment bounds, and immutable access audit trails.",
  },
  managedWorkflowEnforcement: {
    label: "Managed workflow enforcement",
    minimumPlan: "cloud",
    description: "Risk-aware routing, expiring approvals, delegation, and reviewer notifications.",
  },
  siemEventStreaming: {
    label: "SIEM event streaming",
    minimumPlan: "cloud",
    description: "Stream all policy evidence events to Splunk or Microsoft Sentinel in real time.",
  },
  crossSurfaceAgentIdentity: {
    label: "Cross-surface agent identity",
    minimumPlan: "cloud",
    description:
      "Correlate decisions, trust changes, reviewer resolutions, and identity events across surface bindings into one unified history for a single logical agent.",
  },
};

export type FeatureFlagSnapshot = Record<FeatureFlag, boolean>;

const warnedPlanValues = new Set<string>();

export function normalizeSpctrePlan(value?: string | null): SpctrePlan {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "cloud" || normalized === "business" || normalized === "enterprise")
    return normalized;
  if (normalized && normalized !== "oss") {
    if (!warnedPlanValues.has(normalized)) {
      warnedPlanValues.add(normalized);
      console.error(
        `Unrecognized SPCTRE_PLAN "${value}". Falling back to "oss"; expected "oss", "cloud", "business", or "enterprise".`,
      );
    }
  }
  return "oss";
}

export function isFeatureEnabledForPlan(flag: FeatureFlag, plan: SpctrePlan): boolean {
  return planRank[plan] >= planRank[FEATURE_FLAGS[flag].minimumPlan];
}

export function getFeatureFlagSnapshot(plan: SpctrePlan): FeatureFlagSnapshot {
  return Object.fromEntries(
    (Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map((flag) => [
      flag,
      isFeatureEnabledForPlan(flag, plan),
    ]),
  ) as FeatureFlagSnapshot;
}
