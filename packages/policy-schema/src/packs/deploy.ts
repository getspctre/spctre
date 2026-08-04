import type { PolicyPack } from "../types";
import { makePackMetadata } from "./pack-helpers";

// Deploy family packs replace generic 4-rule templated surfaces
// (deployment-v1, kubernetes-v1, vercel-v1, argo-cd-v1) with
// environment-scoped and approval-gated parameter constraints for
// production-impacting operations.

export const DEPLOYMENT_PACK: PolicyPack = {
  id: "deployment-v1",
  name: "Deployment Pipeline Pack",
  connector: "deployment",
  description:
    "Governance rules for agents operating generic deployment pipelines. Blocks unreviewed production deploys and unreviewed secret/environment-variable changes in production.",
  riskLevel: "HIGH",
  tags: ["cicd", "deployments", "environments", "secrets", "rollbacks"],
  domains: ["deployments", "environments", "secrets", "pipelines", "infrastructure"],
  parameters: [
    {
      key: "deployment.protected_environments",
      label: "Environment names requiring approval",
      type: "enum",
      default: ["production"],
      enumValues: ["production", "staging"],
    },
  ],
  metadata: makePackMetadata({
    name: "Deployment Pipeline Pack",
    connector: "deployment",
    riskLevel: "HIGH",
    riskTags: ["cicd", "deployments", "environments"],
    category: "CI/CD and deployment",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Deployment Pipeline pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "deployment.production.unreviewed_deploy.block",
      title: "Block production deploys without a recorded approval",
      effect: "DENY",
      domains: ["deployments", "environments"],
      connectors: ["deployment"],
      actions: ["deployment.create", "deployment.promote"],
      immutable: true,
      parameterConstraints: [
        {
          field: "environment",
          operator: "in",
          value: ["production"],
          parameterKey: "deployment.protected_environments",
        },
        { field: "approved", operator: "eq", value: false },
      ],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC8.1",
          rationale: "Requires recorded approval before production change.",
        },
      ],
    },
    {
      stableRuleId: "deployment.secret.production_write.block",
      title: "Block writing secrets/env vars into production without approval",
      effect: "DENY",
      domains: ["secrets", "environments"],
      connectors: ["deployment"],
      actions: ["secret.update", "environment.update_variable"],
      immutable: true,
      parameterConstraints: [
        {
          field: "environment",
          operator: "in",
          value: ["production"],
          parameterKey: "deployment.protected_environments",
        },
      ],
    },
    {
      stableRuleId: "deployment.rollback.warn",
      title: "Warn on automated production rollback",
      effect: "WARN",
      domains: ["deployments"],
      connectors: ["deployment"],
      actions: ["deployment.rollback"],
      immutable: false,
    },
  ],
};

export const KUBERNETES_PACK: PolicyPack = {
  id: "kubernetes-v1",
  name: "Kubernetes Governance Pack",
  connector: "kubernetes",
  description:
    "Governance rules for agents operating Kubernetes clusters. Blocks cluster-admin RBAC grants and unreviewed secret reads/mounts, and blocks deletions in production namespaces.",
  riskLevel: "HIGH",
  tags: ["infrastructure", "clusters", "deployments", "secrets"],
  domains: ["clusters", "workloads", "rbac", "secrets", "namespaces"],
  parameters: [
    {
      key: "kubernetes.protected_namespaces",
      label: "Namespace names treated as production",
      type: "enum",
      default: ["production", "prod"],
      enumValues: ["production", "prod", "kube-system"],
    },
  ],
  metadata: makePackMetadata({
    name: "Kubernetes Governance Pack",
    connector: "kubernetes",
    riskLevel: "HIGH",
    riskTags: ["infrastructure", "clusters", "rbac"],
    category: "container orchestration",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Kubernetes pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "kubernetes.rbac.cluster_admin_grant.block",
      title: "Block granting cluster-admin RBAC role without approval",
      effect: "DENY",
      domains: ["rbac"],
      connectors: ["kubernetes"],
      actions: ["rbac.create_binding", "rbac.update_binding"],
      immutable: true,
      parameterConstraints: [{ field: "role", operator: "eq", value: "cluster-admin" }],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC6.1",
          rationale: "Restricts cluster-wide privilege escalation.",
        },
      ],
    },
    {
      stableRuleId: "kubernetes.namespace.production_delete.block",
      title: "Block deleting workloads in a production namespace without approval",
      effect: "DENY",
      domains: ["namespaces", "workloads"],
      connectors: ["kubernetes"],
      actions: ["workload.delete", "namespace.delete"],
      immutable: true,
      parameterConstraints: [
        {
          field: "namespace",
          operator: "in",
          value: ["production", "prod"],
          parameterKey: "kubernetes.protected_namespaces",
        },
      ],
    },
    {
      stableRuleId: "kubernetes.secret.mount.warn",
      title: "Warn when a workload mounts a secret it hasn't declared before",
      effect: "WARN",
      domains: ["secrets", "workloads"],
      connectors: ["kubernetes"],
      actions: ["workload.mount_secret"],
      immutable: false,
    },
  ],
};

export const VERCEL_PACK: PolicyPack = {
  id: "vercel-v1",
  name: "Vercel Governance Pack",
  connector: "vercel",
  description:
    "Governance rules for agents operating Vercel. Blocks production domain reassignment and unreviewed production environment-variable changes.",
  riskLevel: "HIGH",
  tags: ["deployments", "projects", "domains", "env"],
  domains: ["projects", "deployments", "domains", "environment", "teams"],
  metadata: makePackMetadata({
    name: "Vercel Governance Pack",
    connector: "vercel",
    riskLevel: "HIGH",
    riskTags: ["deployments", "domains", "env"],
    category: "deployment platform",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Vercel pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "vercel.domain.production_reassign.block",
      title: "Block reassigning a production domain to a different project",
      effect: "DENY",
      domains: ["domains"],
      connectors: ["vercel"],
      actions: ["domain.assign"],
      immutable: true,
    },
    {
      stableRuleId: "vercel.environment.production_var_change.block",
      title: "Block production environment-variable changes without approval",
      effect: "DENY",
      domains: ["environment"],
      connectors: ["vercel"],
      actions: ["environment.update_variable"],
      immutable: true,
      parameterConstraints: [{ field: "target", operator: "in", value: ["production"] }],
    },
  ],
};

export const ARGO_CD_PACK: PolicyPack = {
  id: "argo-cd-v1",
  name: "Argo CD Governance Pack",
  connector: "argo-cd",
  description:
    "Governance rules for agents operating Argo CD GitOps deployments. Blocks disabling auto-sync drift correction and blocks unreviewed application deletion in production clusters.",
  riskLevel: "HIGH",
  tags: ["gitops", "kubernetes", "deployments", "clusters"],
  domains: ["applications", "clusters", "sync", "projects", "secrets"],
  metadata: makePackMetadata({
    name: "Argo CD Governance Pack",
    connector: "argo-cd",
    riskLevel: "HIGH",
    riskTags: ["gitops", "deployments", "clusters"],
    category: "GitOps deployment",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Argo CD pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "argo-cd.application.production_delete.block",
      title: "Block deleting an application targeting a production cluster",
      effect: "DENY",
      domains: ["applications", "clusters"],
      connectors: ["argo-cd"],
      actions: ["application.delete"],
      immutable: true,
      parameterConstraints: [{ field: "destination_cluster", operator: "contains", value: "prod" }],
    },
    {
      stableRuleId: "argo-cd.sync.disable_auto_sync.warn",
      title: "Warn when auto-sync drift correction is disabled",
      effect: "WARN",
      domains: ["sync"],
      connectors: ["argo-cd"],
      actions: ["application.update_sync_policy"],
      immutable: false,
      parameterConstraints: [{ field: "auto_sync_enabled", operator: "eq", value: false }],
    },
  ],
};
