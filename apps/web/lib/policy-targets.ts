import type { PolicyBranch } from "@spctre/policy-schema";

export const ENVIRONMENT_DECLARATIONS = [
  {
    id: "production",
    label: "Production",
    description: "Live traffic and customer-facing automations."
  },
  {
    id: "staging",
    label: "Staging",
    description: "Pre-production validation for replay and rollout checks."
  },
  {
    id: "development",
    label: "Development",
    description: "Sandbox workflows for local iteration and policy drafting."
  },
  {
    id: "incident-mode",
    label: "Incident mode",
    description: "Temporary restrictive overlays used during active incidents."
  }
] as const;

type EnvironmentDeclaration = (typeof ENVIRONMENT_DECLARATIONS)[number];

export interface EnvironmentBranchMapping {
  environment: EnvironmentDeclaration;
  branch?: PolicyBranch;
}

export function mapEnvironmentBranches(branches: PolicyBranch[]): EnvironmentBranchMapping[] {
  return ENVIRONMENT_DECLARATIONS.map((environment) => ({
    environment,
    branch: branches.find(
      (branch) => branch.scope === "ENVIRONMENT" && branch.environment === environment.id
    )
  }));
}

export function describeBranchScope(branch: PolicyBranch): string {
  if (branch.scope === "ENVIRONMENT" && branch.environment) {
    return `${branch.scope} / ${branch.environment}`;
  }

  if (branch.scope === "CONNECTOR" && branch.connector) {
    return `${branch.scope} / ${branch.connector}`;
  }

  return branch.scope;
}