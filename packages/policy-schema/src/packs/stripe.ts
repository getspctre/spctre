import type { PolicyPack } from "../types";
import { makePackMetadata } from "./pack-helpers";

// Stripe family packs replace the generic 4-rule templated surfaces
// (stripe-v1, stripe-billing-v1, stripe-connect-v1, stripe-issuing-v1) with
// domain-specific parameter thresholds and semantic checks for payment
// operations. Deterministic and revision-bound: no live fraud scoring, no
// card data retention — only the tool-call parameters already present in the
// governed request.

export const STRIPE_PACK: PolicyPack = {
  id: "stripe-v1",
  name: "Stripe Governance Pack",
  connector: "stripe",
  description:
    "Governance rules for agents operating Stripe payments, refunds, subscriptions, and payouts. Escalates high-value refunds, blocks payout-destination changes, and blocks bulk customer data exports without compliance approval.",
  riskLevel: "HIGH",
  tags: ["payments", "refunds", "subscriptions", "billing", "pci"],
  domains: ["payments", "refunds", "subscriptions", "billing", "payouts", "customers", "disputes"],
  parameters: [
    {
      key: "stripe.refund_review_threshold_cents",
      label: "Refund amount requiring review (cents)",
      type: "number",
      default: 50000,
      description: "Refunds at or above this amount escalate for review instead of auto-allowing.",
    },
  ],
  metadata: makePackMetadata({
    name: "Stripe Governance Pack",
    connector: "stripe",
    riskLevel: "HIGH",
    riskTags: ["payments", "refunds", "billing", "pci"],
    category: "payment operations",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary:
          "Hand-authored replacement for the generated Stripe pack: refund threshold escalation, payout-destination lockdown, and PCI-scoped export controls.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "stripe.refund.high_value_review",
      title: "Escalate high-value refunds for review",
      effect: "ESCALATE",
      domains: ["refunds", "payments"],
      connectors: ["stripe"],
      actions: ["refund.create"],
      immutable: false,
      parameterConstraints: [
        {
          field: "amount_cents",
          operator: "gte",
          value: 50000,
          parameterKey: "stripe.refund_review_threshold_cents",
        },
      ],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC6.1",
          rationale: "Reviews high-value financial transactions before execution.",
        },
      ],
    },
    {
      stableRuleId: "stripe.payout.destination_change.block",
      title: "Block payout destination changes without approval",
      effect: "DENY",
      domains: ["payouts"],
      connectors: ["stripe"],
      actions: ["payout.update_destination", "account.update_external_account"],
      immutable: true,
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC6.1",
          rationale: "Prevents unreviewed redirection of outbound funds.",
        },
      ],
    },
    {
      stableRuleId: "stripe.customer.bulk_export.block",
      title: "Block bulk customer/payment data exports without compliance approval",
      effect: "DENY",
      domains: ["customers", "payments"],
      connectors: ["stripe"],
      actions: ["customer.bulk_export", "data.bulk_export", "report.export"],
      immutable: true,
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC6.7",
          rationale: "Restricts bulk export of cardholder-adjacent customer data.",
        },
      ],
    },
    {
      stableRuleId: "stripe.dispute.evidence_submission.warn",
      title: "Warn on automated dispute evidence submission",
      effect: "WARN",
      domains: ["disputes"],
      connectors: ["stripe"],
      actions: ["dispute.submit_evidence", "dispute.update"],
      immutable: false,
    },
  ],
};

export const STRIPE_BILLING_PACK: PolicyPack = {
  id: "stripe-billing-v1",
  name: "Stripe Billing Governance Pack",
  connector: "stripe-billing",
  description:
    "Governance rules for Stripe subscription billing. Escalates plan-price changes above a configurable jump threshold and blocks retroactive invoice voiding.",
  riskLevel: "HIGH",
  tags: ["billing", "subscriptions", "invoices", "payments"],
  domains: ["subscriptions", "invoices", "prices", "customers", "payments"],
  parameters: [
    {
      key: "stripe-billing.price_increase_review_ratio",
      label: "Price increase ratio requiring review",
      type: "number",
      default: 2,
      description:
        "A price change at or above this multiple of the prior price escalates for review.",
    },
  ],
  metadata: makePackMetadata({
    name: "Stripe Billing Governance Pack",
    connector: "stripe-billing",
    riskLevel: "HIGH",
    riskTags: ["billing", "subscriptions", "invoices"],
    category: "subscription billing",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Stripe Billing pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "stripe-billing.price.large_increase_review",
      title: "Escalate large subscription price increases for review",
      effect: "ESCALATE",
      domains: ["prices", "subscriptions"],
      connectors: ["stripe-billing"],
      actions: ["price.update"],
      immutable: false,
      parameterConstraints: [
        {
          field: "increase_ratio",
          operator: "gte",
          value: 2,
          parameterKey: "stripe-billing.price_increase_review_ratio",
        },
      ],
    },
    {
      stableRuleId: "stripe-billing.invoice.void_paid.block",
      title: "Block voiding invoices that have already been paid",
      effect: "DENY",
      domains: ["invoices"],
      connectors: ["stripe-billing"],
      actions: ["invoice.void"],
      immutable: true,
      parameterConstraints: [{ field: "status", operator: "eq", value: "paid" }],
      controlMappings: [
        {
          framework: "SOC2",
          controlId: "CC7.2",
          rationale: "Prevents retroactive financial record alteration after payment.",
        },
      ],
    },
  ],
};

export const STRIPE_CONNECT_PACK: PolicyPack = {
  id: "stripe-connect-v1",
  name: "Stripe Connect Platform Billing Governance Pack",
  connector: "stripe-connect",
  description:
    "Governance rules for Stripe Connect marketplace platforms. Blocks unreviewed connected-account payout schedule changes and transfer-recipient changes above a value threshold.",
  riskLevel: "HIGH",
  tags: ["billing", "stripe", "marketplace", "payouts"],
  domains: ["accounts", "transfers", "payouts"],
  parameters: [
    {
      key: "stripe-connect.transfer_review_threshold_cents",
      label: "Transfer amount requiring review (cents)",
      type: "number",
      default: 100000,
      description: "Transfers to a connected account at or above this amount escalate for review.",
    },
  ],
  metadata: makePackMetadata({
    name: "Stripe Connect Platform Billing Governance Pack",
    connector: "stripe-connect",
    riskLevel: "HIGH",
    riskTags: ["billing", "marketplace", "payouts"],
    category: "marketplace platform billing",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Stripe Connect pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "stripe-connect.transfer.high_value_review",
      title: "Escalate high-value transfers to connected accounts",
      effect: "ESCALATE",
      domains: ["transfers"],
      connectors: ["stripe-connect"],
      actions: ["transfer.create"],
      immutable: false,
      parameterConstraints: [
        {
          field: "amount_cents",
          operator: "gte",
          value: 100000,
          parameterKey: "stripe-connect.transfer_review_threshold_cents",
        },
      ],
    },
    {
      stableRuleId: "stripe-connect.account.payout_schedule_change.block",
      title: "Block connected-account payout schedule changes without approval",
      effect: "DENY",
      domains: ["accounts", "payouts"],
      connectors: ["stripe-connect"],
      actions: ["account.update_payout_schedule"],
      immutable: true,
    },
  ],
};

export const STRIPE_ISSUING_PACK: PolicyPack = {
  id: "stripe-issuing-v1",
  name: "Stripe Issuing Governance Pack",
  connector: "stripe-issuing",
  description:
    "Governance rules for Stripe Issuing corporate card operations. Escalates high spending-limit changes and blocks unreviewed card reactivation after a fraud freeze.",
  riskLevel: "HIGH",
  tags: ["finance", "cards", "spending", "authorizations"],
  domains: ["cards", "cardholders", "authorizations"],
  parameters: [
    {
      key: "stripe-issuing.spending_limit_review_cents",
      label: "Spending limit change requiring review (cents)",
      type: "number",
      default: 500000,
    },
  ],
  metadata: makePackMetadata({
    name: "Stripe Issuing Governance Pack",
    connector: "stripe-issuing",
    riskLevel: "HIGH",
    riskTags: ["finance", "cards", "spending"],
    category: "corporate card operations",
    changelog: [
      {
        version: "1.0.0",
        date: "2026-07-20",
        summary: "Hand-authored replacement for the generated Stripe Issuing pack.",
      },
    ],
  }),
  rules: [
    {
      stableRuleId: "stripe-issuing.card.spending_limit_increase_review",
      title: "Escalate large spending limit increases",
      effect: "ESCALATE",
      domains: ["cards"],
      connectors: ["stripe-issuing"],
      actions: ["card.update_spending_limit"],
      immutable: false,
      parameterConstraints: [
        {
          field: "new_limit_cents",
          operator: "gte",
          value: 500000,
          parameterKey: "stripe-issuing.spending_limit_review_cents",
        },
      ],
    },
    {
      stableRuleId: "stripe-issuing.card.reactivate_after_freeze.block",
      title: "Block card reactivation after a fraud freeze without approval",
      effect: "DENY",
      domains: ["cards"],
      connectors: ["stripe-issuing"],
      actions: ["card.update_status"],
      immutable: true,
      parameterConstraints: [
        { field: "previous_status", operator: "eq", value: "canceled" },
        { field: "new_status", operator: "eq", value: "active" },
      ],
    },
  ],
};
