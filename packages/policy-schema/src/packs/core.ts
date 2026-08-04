import type { PolicyPack } from "../types";

// This pack governs inline simulation guidance. It is intentionally
// hand-authored because guidance attribution, human review, and trust/context
// controls are product semantics rather than generated connector coverage.
export const SPCTRE_AGENT_GOVERNANCE_PACK: PolicyPack = {
  id: "spctre-agent-governance-v1",
  name: "Spctre Simulation Guidance Governance Pack",
  connector: "spctre-agent",
  description:
    "A governance boundary for inline simulation guidance. Requires named system attribution and tamper-evident guidance records, preserves human decision authority for approvals, publishing, escalation resolution, and policy changes, and requires reviewer rationale for every recorded disposition.",
  riskLevel: "HIGH",
  tags: ["spctre", "simulation-guidance", "human-review", "operations-log", "audit"],
  domains: ["simulation", "guidance", "approvals", "policy", "audit"],
  metadata: {
    name: "Spctre Simulation Guidance Governance Pack",
    version: "1.0.0",
    connector: "spctre-agent",
    author: "Spctre",
    owner: "Spctre Governance",
    riskLevel: "HIGH",
    riskTags: ["simulation-guidance", "human-review", "audit", "blast-radius"],
    generated: false,
    category: "Simulation guidance governance",
    compatibilityTargets: ["AGT_PREVIEW", "SPCTRE_CONTROL_PLANE"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 2,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-11",
        summary:
          "Initial release: named system attribution, SIMULATION_GUIDANCE audit requirements, reviewer rationale gates, and human authority for resolution, approval, publishing, and policy changes.",
      },
    ],
  },
  rules: [
    // Identity and audit gates make inline guidance attributable before a
    // reviewer can treat it as actionable.
    {
      stableRuleId: "spctre-agent.identity.block_unnamed_principal",
      title: "Block simulation guidance without a named, versioned system principal",
      effect: "DENY",
      domains: ["simulation", "audit"],
      connectors: ["spctre-agent"],
      actions: ["agent.unnamed_action", "agent.unversioned_action", "agent.missing_principal"],
      immutable: true,
    },
    {
      stableRuleId: "spctre-agent.triage.require_agent_triage_log",
      title: "Require SIMULATION_GUIDANCE operations log attribution for inline guidance",
      effect: "DENY",
      domains: ["simulation", "audit"],
      connectors: ["spctre-agent"],
      actions: [
        "simulation.guidance_without_operations_log",
        "simulation.guidance_without_source_payload",
      ],
      immutable: true,
    },
    {
      stableRuleId: "spctre-agent.recommendations.require_operations_log",
      title: "Require human rationale when simulation guidance is recorded",
      effect: "DENY",
      domains: ["guidance", "audit"],
      connectors: ["spctre-agent"],
      actions: ["simulation.guidance_without_rationale"],
      immutable: true,
    },
    // Human decision boundaries preserve reviewer authority over approvals,
    // resolutions, publishing, and policy changes.
    {
      stableRuleId: "spctre-agent.triage.require_human_rationale",
      title:
        "Require human reviewer rationale before triage recommendations are accepted, edited, or rejected",
      effect: "DENY",
      domains: ["triage", "agent-actions"],
      connectors: ["spctre-agent"],
      actions: [
        "triage.accept_without_rationale",
        "triage.edit_without_rationale",
        "triage.reject_without_rationale",
      ],
      immutable: true,
    },
    {
      stableRuleId: "spctre-agent.escalations.block_agent_resolution",
      title: "Preserve human authority to resolve escalation queue items",
      effect: "DENY",
      domains: ["triage", "agent-actions"],
      connectors: ["spctre-agent"],
      actions: ["escalation.resolve", "escalation.abort", "escalation.proceed", "gateway.resolve"],
      immutable: true,
    },
    {
      stableRuleId: "spctre-agent.approvals.block_agent_approval",
      title: "Preserve human authority in policy approvals",
      effect: "DENY",
      domains: ["approvals", "agent-actions"],
      connectors: ["spctre-agent"],
      actions: ["approval.approve", "approval.reject", "approval.record", "approval.delegate"],
      immutable: true,
    },
    {
      stableRuleId: "spctre-agent.policy.block_agent_mutation",
      title: "Preserve human authority to publish and change policy revisions",
      effect: "DENY",
      domains: ["policy", "agent-actions"],
      connectors: ["spctre-agent"],
      actions: [
        "policy.publish",
        "policy.commit",
        "rule.modify",
        "rule.delete",
        "baseline.promote",
      ],
      immutable: true,
    },
    // Guidance quality warnings surface missing risk context without blocking
    // a human reviewer from handling the guidance.
    {
      stableRuleId: "spctre-agent.recommendations.warn_missing_blast_radius",
      title: "Warn when simulation guidance omits blast-radius classification",
      effect: "WARN",
      domains: ["guidance", "audit"],
      connectors: ["spctre-agent"],
      actions: ["simulation.guidance"],
      immutable: false,
      semanticChecks: [
        {
          id: "spctre-agent.recommendations.warn_missing_blast_radius-sc-1",
          prompt: "check for missing blast radius or risk analysis in plan",
          effect: "WARN",
        },
      ],
    },
  ],
};

export const TRUST_GOVERNANCE_PACK: PolicyPack = {
  id: "trust-governance-v1",
  name: "Trust and Context Budget Governance Pack",
  connector: "trust-governance",
  description:
    "Governance rules for trust-score calibration and context budget management across agent sessions. Escalates low-trust agents in high-consequence environments, warns on context budget overruns, blocks actions from agents with critically low trust scores, and requires human review before trust restoration. Designed as a governance input to Decision Gateway workflows.",
  riskLevel: "HIGH",
  tags: ["trust", "context-budget", "calibration", "decay", "multi-turn", "sessions", "governance"],
  domains: ["trust", "context", "sessions", "agents", "gateway"],
  metadata: {
    name: "Trust and Context Budget Governance Pack",
    version: "1.0.0",
    connector: "trust-governance",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "HIGH",
    riskTags: ["trust", "context-budget", "calibration", "sessions"],
    generated: false,
    category: "Trust and context budget governance",
    compatibilityTargets: [
      "AGT_PREVIEW",
      "OPENAI_AGENTS",
      "LANGCHAIN",
      "CREWAI",
      "AUTOGEN",
      "AWS_BEDROCK",
      "GOOGLE_ADK",
      "AZURE_AI",
      "CUSTOM",
    ],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 2,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-14",
        summary:
          "Initial pack: low-trust escalation, critical-trust block, context budget overrun warn/escalate, trust decay audit, and trust restoration review rules.",
      },
    ],
  },
  rules: [
    // Trust score rules are runtime gates used by Decision Gateway workflows:
    // critical trust failures block, while lower-severity drift remains visible.
    {
      stableRuleId: "trust-governance.trust_score.block_critically_low",
      title: "Block actions from agents with critically low trust scores in production",
      effect: "DENY",
      domains: ["trust", "agents"],
      connectors: ["trust-governance"],
      actions: ["agent.action", "tool.execute", "decision.proceed"],
      immutable: true,
    },
    {
      stableRuleId: "trust-governance.trust_score.escalate_low_high_consequence",
      title: "Escalate to human review when a low-trust agent attempts a high-consequence action",
      effect: "DENY",
      domains: ["trust", "gateway"],
      connectors: ["trust-governance"],
      actions: ["agent.action", "decision.proceed", "gateway.decide"],
      immutable: true,
    },
    {
      stableRuleId: "trust-governance.trust_score.warn_below_threshold",
      title: "Warn when agent trust score drops below the workspace warn threshold",
      effect: "WARN",
      domains: ["trust", "agents"],
      connectors: ["trust-governance"],
      actions: ["agent.action", "tool.execute", "trust.score_change"],
      immutable: false,
    },
    // Context budget rules treat runaway context growth as an operational risk
    // signal before it turns into uncontrolled cost or low-quality execution.
    {
      stableRuleId: "trust-governance.context_budget.warn_overrun",
      title: "Warn when session context token count exceeds the configured budget warn threshold",
      effect: "WARN",
      domains: ["context", "sessions"],
      connectors: ["trust-governance"],
      actions: ["session.call", "llm_call", "context.token_growth"],
      immutable: false,
    },
    {
      stableRuleId: "trust-governance.context_budget.escalate_severe_overrun",
      title: "Escalate when session context token count exceeds the escalation threshold",
      effect: "DENY",
      domains: ["context", "sessions"],
      connectors: ["trust-governance"],
      actions: ["session.call", "llm_call", "context.budget_breach"],
      immutable: true,
    },
    {
      stableRuleId: "trust-governance.decay.warn_rapid_drop",
      title: "Warn when agent trust score drops by more than 0.1 in a single observation window",
      effect: "WARN",
      domains: ["trust", "agents"],
      connectors: ["trust-governance"],
      actions: ["trust.score_change", "trust.decay"],
      immutable: false,
    },
    {
      stableRuleId: "trust-governance.restoration.require_review",
      title:
        "Require human policy review before restoring trust score above a previously breached threshold",
      effect: "DENY",
      domains: ["trust", "gateway"],
      connectors: ["trust-governance"],
      actions: ["trust.restore", "trust.override", "trust.manual_adjust"],
      immutable: true,
    },
    {
      stableRuleId: "trust-governance.context_budget.warn_high_summarization",
      title:
        "Warn when a session records multiple summarization events indicating context pressure",
      effect: "WARN",
      domains: ["context", "sessions"],
      connectors: ["trust-governance"],
      actions: ["context.summarization", "session.summarize"],
      immutable: false,
    },
  ],
};
