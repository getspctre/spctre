import type { PolicyPack } from "../types";

// Entire session rules cover the pre-deployment gap: AI-generated code can
// change production-bound artifacts before runtime gateways ever see activity.
// These rules turn checkpoint metadata into governance evidence.
export const ENTIRE_SESSION_AUDIT_PACK: PolicyPack = {
  id: "entire-session-audit-v1",
  name: "Entire CLI Session Audit Pack",
  connector: "entire-session",
  description:
    "Pre-deployment AI code-generation governance for Entire sessions. An Entire adapter submits normalized checkpoints and diffs through the framework-agnostic Git checkpoint ingestion API. Blocks sessions with no agent attribution, warns on sensitive file touches, high AI authorship percentage, high token usage, and high-blast-radius tool calls — closing the governance gap between AI-assisted code authorship and runtime agent enforcement.",
  riskLevel: "HIGH",
  tags: ["entire", "pre-deployment", "code-generation", "tool-calls", "session-audit", "ai-authorship"],
  domains: ["tool-calls", "sessions", "files", "authorship", "audit"],
  metadata: {
    name: "Entire CLI Session Audit Pack",
    version: "1.0.0",
    connector: "entire-session",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "HIGH",
    riskTags: ["entire", "pre-deployment", "tool-calls", "audit"],
    generated: false,
    category: "Pre-deployment AI code-generation governance",
    compatibilityTargets: ["AGT_PREVIEW", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 2,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-19",
        summary:
          "Initial pack: missing agent attribution block, sensitive path warn, high AI authorship warn, high token usage warn, high-blast-radius tool call warn, and ungoverned kind warn.",
      },
    ],
  },
  rules: [
    {
      // Fires when the session metadata has no agent field — no attribution means no governance.
      stableRuleId: "entire-session.identity.block_missing_attribution",
      title: "Block sessions with no agent attribution in the Entire checkpoint metadata",
      effect: "DENY",
      domains: ["authorship", "audit"],
      connectors: ["entire-session"],
      actions: ["session.standard", "session.agent_investigate", "session.commit"],
      immutable: true,
    },
    {
      // files_touched in checkpoint metadata is compared against sensitive path patterns.
      stableRuleId: "entire-session.files.warn_sensitive_path",
      title: "Warn when a session touches sensitive paths (env files, secrets, key material)",
      effect: "WARN",
      domains: ["files", "audit"],
      connectors: ["entire-session"],
      actions: ["session.standard", "session.agent_investigate"],
      immutable: false,
    },
    {
      // initial_attribution.agent_percentage > 80 indicates predominantly AI-authored changes.
      stableRuleId: "entire-session.authorship.warn_high_agent_percentage",
      title: "Warn when AI authorship percentage exceeds 80% for the committed changeset",
      effect: "WARN",
      domains: ["authorship", "audit"],
      connectors: ["entire-session"],
      actions: ["session.commit", "session.standard"],
      immutable: false,
    },
    {
      // token_usage.output_tokens + input_tokens as a proxy for session cost and scope.
      stableRuleId: "entire-session.tokens.warn_high_usage",
      title: "Warn when session total token usage exceeds the workspace threshold",
      effect: "WARN",
      domains: ["sessions", "audit"],
      connectors: ["entire-session"],
      actions: ["session.end", "session.standard"],
      immutable: false,
    },
    {
      // Detected by parsing full.jsonl for tool_use blocks with high-blast-radius tool names.
      stableRuleId: "entire-session.scope.warn_high_blast_radius",
      title: "Warn when a session invokes high-blast-radius tools (Bash, Shell, Computer, Write)",
      effect: "WARN",
      domains: ["tool-calls", "sessions"],
      connectors: ["entire-session"],
      actions: ["session.tool_call", "session.standard", "session.agent_investigate"],
      immutable: false,
    },
    {
      // kind:"agent_investigate" sessions run autonomous multi-agent workflows — surface for review.
      stableRuleId: "entire-session.kind.warn_investigation_session",
      title: "Warn when an autonomous multi-agent investigation session is detected",
      effect: "WARN",
      domains: ["authorship", "sessions"],
      connectors: ["entire-session"],
      actions: ["session.agent_investigate"],
      immutable: false,
    },
  ],
};
