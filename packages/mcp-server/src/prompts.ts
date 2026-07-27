import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

interface McpPromptTemplate {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  render: (args: Record<string, unknown> | undefined) => string;
}

function stringArg(args: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = args?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const PROMPT_TEMPLATES: McpPromptTemplate[] = [
  {
    name: "policy-governance-101",
    description: "Guidance on when and how to use governance tools",
    arguments: [
      {
        name: "governance_scenario",
        description: "Governance scenario name",
        required: false,
      },
    ],
    render: (args) => {
      const scenario = stringArg(args, "governance_scenario");
      return `You are a policy governance expert for Spctre.${scenario ? ` Scenario: ${scenario}.` : ""}`;
    },
  },
  {
    name: "evidence-investigation",
    description: "Template for investigating policy decisions",
    arguments: [
      {
        name: "decision_id",
        description: "Decision ID to investigate",
        required: false,
      },
    ],
    render: (args) => {
      const decisionId = stringArg(args, "decision_id");
      return `Investigate policy decision evidence.${decisionId ? ` Decision ID: ${decisionId}.` : ""}`;
    },
  },
  {
    name: "gateway-integration-check",
    description: "Checklist for verifying MCP gateway decisions and evidence ingestion end to end",
    arguments: [
      {
        name: "connector",
        description: "Connector under test",
        required: false,
      },
      {
        name: "decision_id",
        description: "Decision or evidence ID to verify",
        required: false,
      },
    ],
    render: (args) => {
      const connector = stringArg(args, "connector") ?? "the connector";
      const decisionId = stringArg(args, "decision_id");
      return [
        `Verify MCP gateway integration for ${connector}.`,
        "Confirm evaluate_policy calls /api/gateway/decide with branch, revision, and artifact context.",
        "Confirm create_evidence_record writes /api/evidence with x-spctre-source=mcp.",
        "Check duplicate hook/MCP submissions return deduplicated evidence rather than two audit rows.",
        decisionId ? `Use decision ID ${decisionId} as the trace anchor.` : "Capture the decision ID and use it as the trace anchor.",
      ].join(" ");
    },
  },
  {
    name: "escalation-review-brief",
    description: "Brief for summarizing pending HITL escalation queue items",
    arguments: [
      {
        name: "queue_scope",
        description: "Queue, workspace, connector, or incident scope",
        required: false,
      },
    ],
    render: (args) => {
      const queueScope = stringArg(args, "queue_scope") ?? "the current workspace";
      return [
        `Prepare a reviewer brief for pending Spctre escalations in ${queueScope}.`,
        "Group items by connector, risk reason, SLA age, and policy reference.",
        "Call list_pending_escalations first, then fetch related evidence before recommending approve, abort, or request-more-context.",
      ].join(" ");
    },
  },
  {
    name: "mcp-client-hardening",
    description: "Operational checklist for MCP client composition, transport auth, and backpressure",
    arguments: [
      {
        name: "client_name",
        description: "Client or runtime being hardened",
        required: false,
      },
    ],
    render: (args) => {
      const clientName = stringArg(args, "client_name") ?? "this MCP client";
      return [
        `Harden ${clientName} against governance transport failures.`,
        "Verify bearer or refresh-token auth, workspace scoping, connector allowlists, retry behavior, and evidence deduplication.",
        "For HTTP/SSE, confirm readiness, session capacity, message authorization, and graceful recovery after dropped sessions.",
      ].join(" ");
    },
  },
];

export function listPromptTemplates(): Prompt[] {
  return PROMPT_TEMPLATES.map(({ name, description, arguments: args }) => ({
    name,
    description,
    arguments: args,
  }));
}

export function renderPromptTemplate(name: string, args: Record<string, unknown> | undefined): string {
  const template = PROMPT_TEMPLATES.find((candidate) => candidate.name === name);
  if (!template) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return template.render(args);
}
