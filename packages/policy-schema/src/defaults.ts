import type { EvidenceRetentionRule } from "./types";

export const RETENTION_RULES: EvidenceRetentionRule[] = [
  {
    id: "ret-deny-production",
    label: "Production deny evidence",
    retentionDays: 1095,
    appliesTo: { statuses: ["DENY"], environments: ["production"] },
    exportable: true,
  },
  {
    id: "ret-warning-production",
    label: "Production warnings",
    retentionDays: 365,
    appliesTo: { statuses: ["WARN"], environments: ["production"] },
    exportable: true,
  },
  {
    id: "ret-local-staging",
    label: "Staging replay evidence",
    retentionDays: 2,
    appliesTo: { environments: ["staging"], runtimeStacks: ["LOCAL"] },
    exportable: false,
  },
];

export const DEFAULT_EXPIRING_WITHIN_DAYS = 7;
export const DEFAULT_COMPLIANCE_RETENTION_DAYS = 90;
export const VERIFICATION_STALE_DAYS = 7;
