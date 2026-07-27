import type { PolicyApprovalRule } from "@spctre/policy-schema";

export const REQUIRED_APPROVAL_RULES: PolicyApprovalRule[] = [
  { role: "Security", requiredCount: 1 },
  { role: "Platform", requiredCount: 1 }
];

export const ALL_REVIEWER_ROLES = ["Security", "Platform", "Legal", "Ops", "Admin"] as const;
