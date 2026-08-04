import type { PolicyPack } from "../types";
import { makePackMetadata } from "./pack-helpers";

// GitHub family packs replace generic 4-rule templated surfaces (github-v1,
// github-actions-v1, github-enterprise-admin-v1) with branch-protection and
// CI-secret-scoped parameter constraints.

export const GITHUB_PACK: PolicyPack = {
  id: "github-v1",
  name: "GitHub Operations Pack",
  connector: "github",
  description:
    "Governance rules for agents operating GitHub repositories. Blocks force-pushes and deletions of protected branches, and blocks secret exposure in repository visibility changes.",
  riskLevel: "HIGH",
  tags: ["code", "deployments", "secrets", "branches", "ci"],
  domains: ["repositories", "branches", "deployments", "secrets", "workflows"],
  parameters: [
    {
      key: "github.protected_branches",
      label: "Branch names treated as protected",
      type: "enum",
      default: ["main", "master"],
      enumValues: ["main", "master", "release", "production"],
    },
  ],
  metadata: makePackMetadata({
    name: "GitHub Operations Pack",
    connector: "github",
    riskLevel: "HIGH",
    riskTags: ["code", "branches", "secrets"],
    category: "source control and repository operations",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated GitHub pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "github.branch.force_push_protected.block",
      title: "Block force-pushing to a protected branch",
      effect: "DENY",
      domains: ["branches"],
      connectors: ["github"],
      actions: ["branch.push"],
      immutable: true,
      parameterConstraints: [
        {
          field: "ref",
          operator: "in",
          value: ["main", "master"],
          parameterKey: "github.protected_branches",
        },
        { field: "force", operator: "eq", value: true },
      ],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC8.1",
          rationale: "Prevents unreviewed history rewrite on protected branches.",
        },
      ],
    },
    {
      stableRuleId: "github.branch.delete_protected.block",
      title: "Block deleting a protected branch",
      effect: "DENY",
      domains: ["branches"],
      connectors: ["github"],
      actions: ["branch.delete"],
      immutable: true,
      parameterConstraints: [
        {
          field: "ref",
          operator: "in",
          value: ["main", "master"],
          parameterKey: "github.protected_branches",
        },
      ],
    },
    {
      stableRuleId: "github.repository.visibility_change.block",
      title: "Block changing repository visibility to public without approval",
      effect: "DENY",
      domains: ["repositories"],
      connectors: ["github"],
      actions: ["repository.update_visibility"],
      immutable: true,
      parameterConstraints: [{ field: "new_visibility", operator: "eq", value: "public" }],
    },
    {
      stableRuleId: "github.secret.bulk_read.warn",
      title: "Warn on bulk reads of repository/organization secrets",
      effect: "WARN",
      domains: ["secrets"],
      connectors: ["github"],
      actions: ["secret.list", "secret.bulk_read"],
      immutable: false,
    },
  ],
};

export const GITHUB_ACTIONS_PACK: PolicyPack = {
  id: "github-actions-v1",
  name: "GitHub Actions Governance Pack",
  connector: "github-actions",
  description:
    "Governance rules for agents operating GitHub Actions. Blocks workflow secret exfiltration to third-party actions and unreviewed self-hosted runner registration.",
  riskLevel: "HIGH",
  tags: ["ci", "github", "actions", "workflows"],
  domains: ["workflows", "secrets", "runners"],
  metadata: makePackMetadata({
    name: "GitHub Actions Governance Pack",
    connector: "github-actions",
    riskLevel: "HIGH",
    riskTags: ["ci", "secrets", "runners"],
    category: "CI/CD execution",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated GitHub Actions pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "github-actions.workflow.unpinned_third_party_action.block",
      title: "Block workflow runs referencing an unpinned third-party action",
      effect: "DENY",
      domains: ["workflows"],
      connectors: ["github-actions"],
      actions: ["workflow.run"],
      immutable: true,
      semanticChecks: [
        {
          id: "github-actions-sc-1",
          prompt: "check for unpinned or mutable third-party action reference",
          effect: "DENY",
        },
      ],
    },
    {
      stableRuleId: "github-actions.runner.self_hosted_register.review",
      title: "Escalate registering a new self-hosted runner",
      effect: "ESCALATE",
      domains: ["runners"],
      connectors: ["github-actions"],
      actions: ["runner.register"],
      immutable: false,
    },
  ],
};

export const GITHUB_ENTERPRISE_ADMIN_PACK: PolicyPack = {
  id: "github-enterprise-admin-v1",
  name: "GitHub Enterprise Admin Governance Pack",
  connector: "github-enterprise-admin",
  description:
    "Governance rules for agents operating GitHub Enterprise organization administration. Blocks unreviewed SSO/SAML policy changes and organization-owner role grants.",
  riskLevel: "HIGH",
  tags: ["code", "identity", "admin", "security"],
  domains: ["organizations", "repositories", "teams", "policies", "audit"],
  metadata: makePackMetadata({
    name: "GitHub Enterprise Admin Governance Pack",
    connector: "github-enterprise-admin",
    riskLevel: "HIGH",
    riskTags: ["identity", "admin", "security"],
    category: "source control administration",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated GitHub Enterprise Admin pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "github-enterprise-admin.owner.grant.block",
      title: "Block granting organization-owner role without approval",
      effect: "DENY",
      domains: ["organizations", "teams"],
      connectors: ["github-enterprise-admin"],
      actions: ["organization.update_member_role"],
      immutable: true,
      parameterConstraints: [{ field: "new_role", operator: "eq", value: "owner" }],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC6.1",
          rationale: "Restricts privilege escalation to organization owner.",
        },
      ],
    },
    {
      stableRuleId: "github-enterprise-admin.sso_policy.change.block",
      title: "Block SSO/SAML enforcement policy changes without approval",
      effect: "DENY",
      domains: ["policies"],
      connectors: ["github-enterprise-admin"],
      actions: ["policy.update_sso", "policy.update_saml"],
      immutable: true,
    },
  ],
};
