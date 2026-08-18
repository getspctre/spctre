/**
 * Documents that describe hosted or commercial-only functionality.
 *
 * The control plane renders the complete corpus from apps/web/content/docs.
 * GitHub Pages must never publish these pages: the public site documents the
 * Apache-2.0 distribution, while hosted customers receive plan-specific docs
 * in the control plane.
 */
export const hostedOnlyDocuments = [
  "developer/agents/cross-surface-identity.mdx",
  "developer/integrations/siem-streaming.mdx",
  "developer/reference/plan-tiers.mdx",
  "ui-guides/workspace-admin/scim-provisioning.mdx",
  "ui-guides/workspace-admin/siem-streaming.mdx",
];

/**
 * Documents that combine OSS guidance with hosted-only commands, interfaces,
 * or operational guarantees. They remain complete in the control plane. The
 * public build replaces them with an availability notice until a reviewed OSS
 * variant is added for that exact path.
 */
export const mixedAudienceDocuments = [
  "ai-agents/getting-started/operating-model.mdx",
  "ai-agents/operations/escalation-handling.mdx",
  "developer/agents/escalations.mdx",
  "developer/integrations/gateway.mdx",
  "developer/integrations/mcp-server.mdx",
  "developer/integrations/notion.mdx",
  "developer/integrations/oauth-social-login.mdx",
  "developer/integrations/scale-to-zero.mdx",
  "developer/integrations/sso.mdx",
  "developer/integrations/webhooks.mdx",
  "developer/policies/simulate.mdx",
  "developer/policies/trust-governance.mdx",
  "developer/reference/env-vars.mdx",
  "ui-guides/compliance-officer/audit-ledger.mdx",
  "ui-guides/compliance-officer/reading-compliance-reports.mdx",
  "ui-guides/index.mdx",
  "ui-guides/reviewer/alerting-setup.mdx",
  "ui-guides/reviewer/handling-escalations.mdx",
  "ui-guides/reviewer/overview.mdx",
  "ui-guides/reviewer/reassigning-escalations.mdx",
  "ui-guides/workspace-admin/admin-audit-log.mdx",
  "ui-guides/workspace-admin/configuring-alerting.mdx",
  "ui-guides/workspace-admin/configuring-sso.mdx",
  "ui-guides/workspace-admin/inviting-users.mdx",
  "ui-guides/workspace-admin/managing-roles.mdx",
  "ui-guides/workspace-admin/overview.mdx",
  "ui-guides/workspace-admin/workspace-settings.mdx",
];
