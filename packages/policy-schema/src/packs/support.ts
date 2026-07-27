import type { PolicyPack } from "../types";
import { makePackMetadata } from "./pack-helpers";

// Support family packs replace generic 4-rule templated surfaces
// (zendesk-v1, zendesk-support-admin-v1) with PII-exposure semantic checks
// on customer-facing replies and macro/admin lockdowns.

export const ZENDESK_PACK: PolicyPack = {
  id: "zendesk-v1",
  name: "Zendesk Support Pack",
  connector: "zendesk",
  description:
    "Governance rules for agents operating Zendesk. Warns when a customer-facing reply appears to expose PII/regulated data, and blocks bulk ticket exports without compliance approval.",
  riskLevel: "HIGH",
  tags: ["support", "tickets", "customers", "sla", "macros"],
  domains: ["tickets", "macros", "users", "views", "organizations"],
  metadata: makePackMetadata({
    name: "Zendesk Support Pack",
    connector: "zendesk",
    riskLevel: "HIGH",
    riskTags: ["support", "tickets", "customers"],
    category: "customer support",
    changelog: [{ version: "1.0.0", date: "2026-07-20", summary: "Hand-authored replacement for the generated Zendesk pack." }],
  }),
  rules: [
    {
      stableRuleId: "zendesk.reply.pii_exposure.warn",
      title: "Warn when a customer-facing reply appears to expose PII or regulated data",
      effect: "WARN",
      domains: ["tickets"],
      connectors: ["zendesk"],
      actions: ["ticket.reply", "ticket.comment.public"],
      immutable: false,
      semanticChecks: [
        { id: "zendesk-reply-sc-1", prompt: "check for pii or regulated data exposure in customer reply", effect: "WARN" },
      ],
      controlMappings: [
        { framework: "HIPAA", controlId: "164.502", rationale: "Flags potential unauthorized disclosure of regulated data in a support reply." },
      ],
    },
    {
      stableRuleId: "zendesk.ticket.bulk_export.block",
      title: "Block bulk ticket exports without compliance approval",
      effect: "DENY",
      domains: ["tickets"],
      connectors: ["zendesk"],
      actions: ["ticket.bulk_export", "data.bulk_export"],
      immutable: true,
    },
    {
      stableRuleId: "zendesk.macro.bulk_apply.warn",
      title: "Warn on bulk macro application across many tickets",
      effect: "WARN",
      domains: ["tickets", "macros"],
      connectors: ["zendesk"],
      actions: ["macro.bulk_apply"],
      immutable: false,
      parameterConstraints: [{ field: "ticket_count", operator: "gte", value: 100 }],
    },
  ],
};

export const ZENDESK_SUPPORT_ADMIN_PACK: PolicyPack = {
  id: "zendesk-support-admin-v1",
  name: "Zendesk Support Admin Governance Pack",
  connector: "zendesk-support-admin",
  description:
    "Governance rules for agents operating Zendesk administration. Blocks unreviewed agent-role escalation and unreviewed SLA policy changes.",
  riskLevel: "HIGH",
  tags: ["support", "admin", "users", "settings"],
  domains: ["users", "triggers", "settings"],
  metadata: makePackMetadata({
    name: "Zendesk Support Admin Governance Pack",
    connector: "zendesk-support-admin",
    riskLevel: "HIGH",
    riskTags: ["support", "admin", "users"],
    category: "customer support administration",
    changelog: [{ version: "1.0.0", date: "2026-07-20", summary: "Hand-authored replacement for the generated Zendesk Support Admin pack." }],
  }),
  rules: [
    {
      stableRuleId: "zendesk-support-admin.user.role_escalation.block",
      title: "Block escalating an agent to administrator without approval",
      effect: "DENY",
      domains: ["users"],
      connectors: ["zendesk-support-admin"],
      actions: ["user.update_role"],
      immutable: true,
      parameterConstraints: [{ field: "new_role", operator: "eq", value: "admin" }],
    },
    {
      stableRuleId: "zendesk-support-admin.sla_policy.change.warn",
      title: "Warn on SLA policy changes",
      effect: "WARN",
      domains: ["settings"],
      connectors: ["zendesk-support-admin"],
      actions: ["settings.update_sla_policy"],
      immutable: false,
    },
  ],
};
