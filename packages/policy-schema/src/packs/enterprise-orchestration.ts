import type { PolicyPack } from "../types";

// Enterprise orchestration packs model vendor platforms that coordinate agents
// across trust boundaries. The shared intent is to surface routing,
// delegation, guardrail, and provenance gaps even when the platform does not
// emit AGT-compatible evidence natively.
export const AGENT_FABRIC_PACK: PolicyPack = {
  id: "agent-fabric-v1",
  name: "Salesforce Agent Fabric Governance Pack",
  connector: "agent-fabric",
  description:
    "Governance rules for agents orchestrated through Salesforce Agent Fabric. Enforces spend caps on AI Gateway LLM calls, warns on unverified vendor routing decisions, flags cross-vendor A2A delegations that exit the approved trust boundary, surfaces guardrail override events, and marks evidence with a provenance gap indicator — reflecting that Agent Fabric does not natively emit AGT-compatible evidence.",
  riskLevel: "MEDIUM",
  tags: [
    "salesforce",
    "agent-fabric",
    "orchestration",
    "multi-vendor",
    "a2a",
    "agentforce",
    "cost",
    "routing",
  ],
  domains: ["requests", "agent-calls", "routing", "cost", "delegation"],
  metadata: {
    name: "Salesforce Agent Fabric Governance Pack",
    version: "1.0.0",
    connector: "agent-fabric",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "MEDIUM",
    riskTags: ["salesforce", "agent-fabric", "multi-vendor", "routing"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: [
      "AGT_PREVIEW",
      "CREWAI",
      "LANGCHAIN",
      "OPENAI_AGENTS",
      "AUTOGEN",
      "CUSTOM",
    ],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: spend cap, unverified vendor routing, cross-vendor A2A delegation, guardrail override, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "agent-fabric.cost.block_high_spend",
      title: "Block AI Gateway LLM calls exceeding per-call spend cap",
      effect: "DENY",
      domains: ["cost", "requests"],
      connectors: ["agent-fabric"],
      actions: ["llm_call", "chat.completions", "completions"],
      immutable: true,
    },
    {
      stableRuleId: "agent-fabric.routing.warn_unverified_vendor",
      title: "Warn when Agent Broker routes to a vendor not in the approved-vendor list",
      effect: "WARN",
      domains: ["routing", "agent-calls"],
      connectors: ["agent-fabric"],
      actions: ["routing.vendor_select", "agent.dispatch", "llm_call"],
      immutable: false,
    },
    {
      stableRuleId: "agent-fabric.delegation.warn_cross_vendor_a2a",
      title: "Warn when an A2A delegation crosses vendor trust boundaries to a third-party agent",
      effect: "WARN",
      domains: ["delegation", "agent-calls"],
      connectors: ["agent-fabric"],
      actions: ["agent.delegate", "agent.handoff", "a2a.invoke"],
      immutable: true,
    },
    {
      stableRuleId: "agent-fabric.guardrails.warn_override",
      title: "Warn when an agent action bypasses or exceeds a configured Agent Fabric guardrail",
      effect: "WARN",
      domains: ["agent-calls", "routing"],
      connectors: ["agent-fabric"],
      actions: ["guardrail.bypass", "guardrail.override", "agent.action"],
      immutable: true,
    },
    {
      stableRuleId: "agent-fabric.provenance.warn_gap",
      title: "Warn on Agent Fabric events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "routing"],
      connectors: ["agent-fabric"],
      actions: ["agent.dispatch", "llm_call", "agent.delegate"],
      immutable: false,
    },
  ],
};

export const COPILOT_STUDIO_PACK: PolicyPack = {
  id: "copilot-studio-v1",
  name: "Microsoft Copilot Studio Governance Pack",
  connector: "copilot-studio",
  description:
    "Governance rules for agents built and deployed through Microsoft Copilot Studio. Warns on M365 content access without sensitivity labels, flags Power Automate flows with destructive actions, surfaces cross-environment A2A delegations, detects DLP policy bypasses, and marks evidence with a provenance gap indicator — reflecting that Copilot Studio does not natively emit AGT-compatible evidence.",
  riskLevel: "MEDIUM",
  tags: ["microsoft", "copilot-studio", "m365", "power-platform", "a2a", "dlp", "orchestration"],
  domains: ["requests", "agent-calls", "data", "delegation", "actions"],
  metadata: {
    name: "Microsoft Copilot Studio Governance Pack",
    version: "1.0.0",
    connector: "copilot-studio",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "MEDIUM",
    riskTags: ["microsoft", "copilot-studio", "m365", "dlp"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: M365 sensitivity gap, Power Automate blast radius, cross-environment A2A delegation, DLP bypass, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "copilot-studio.data.warn_m365_sensitivity_unclassified",
      title:
        "Warn when agent accesses M365 content without a declared sensitivity label classification",
      effect: "WARN",
      domains: ["data", "agent-calls"],
      connectors: ["copilot-studio"],
      actions: ["data.read", "sharepoint.read", "onedrive.read", "exchange.read"],
      immutable: false,
    },
    {
      stableRuleId: "copilot-studio.actions.warn_high_blast_radius_flow",
      title:
        "Warn when agent triggers a Power Automate flow containing write, delete, or send actions",
      effect: "WARN",
      domains: ["actions", "agent-calls"],
      connectors: ["copilot-studio"],
      actions: ["flow.trigger", "flow.run", "action.write", "action.delete", "action.send"],
      immutable: true,
    },
    {
      stableRuleId: "copilot-studio.delegation.warn_cross_environment_a2a",
      title:
        "Warn when an agent delegates via Work IQ A2A to an agent outside the approved Copilot Studio environment",
      effect: "WARN",
      domains: ["delegation", "agent-calls"],
      connectors: ["copilot-studio"],
      actions: ["agent.delegate", "agent.handoff", "a2a.invoke"],
      immutable: true,
    },
    {
      stableRuleId: "copilot-studio.dlp.warn_policy_bypass",
      title: "Warn when an agent action is scoped outside an active DLP policy boundary",
      effect: "WARN",
      domains: ["data", "actions"],
      connectors: ["copilot-studio"],
      actions: ["dlp.bypass", "connector.non_business", "action.external_api"],
      immutable: true,
    },
    {
      stableRuleId: "copilot-studio.provenance.warn_gap",
      title: "Warn on Copilot Studio events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["copilot-studio"],
      actions: ["agent.dispatch", "agent.action", "flow.trigger"],
      immutable: false,
    },
  ],
};

export const SERVICENOW_AI_CONTROL_TOWER_PACK: PolicyPack = {
  id: "servicenow-ai-control-tower-v1",
  name: "ServiceNow AI Control Tower Governance Pack",
  connector: "servicenow-ai-control-tower",
  description:
    "Governance rules for agents orchestrated through ServiceNow AI Control Tower and Action Fabric. Blocks unapproved CMDB writes, warns on production system changes, flags external agent invocations via Action Fabric, surfaces autonomous desktop execution events without human checkpoints, and marks evidence with a provenance gap indicator — reflecting that ServiceNow does not natively emit AGT-compatible evidence.",
  riskLevel: "HIGH",
  tags: [
    "servicenow",
    "ai-control-tower",
    "action-fabric",
    "itsm",
    "cmdb",
    "production",
    "orchestration",
  ],
  domains: ["requests", "agent-calls", "actions", "delegation", "production"],
  metadata: {
    name: "ServiceNow AI Control Tower Governance Pack",
    version: "1.0.0",
    connector: "servicenow-ai-control-tower",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "HIGH",
    riskTags: ["servicenow", "itsm", "cmdb", "production"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE", "PLATFORM"],
    minimumApprovals: 2,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: CMDB write block, production system change warning, external agent invocation, autonomous desktop execution, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "servicenow-ai-control-tower.actions.block_cmdb_write_unapproved",
      title: "Block agent CMDB writes when no open approved change record exists",
      effect: "DENY",
      domains: ["actions", "agent-calls"],
      connectors: ["servicenow-ai-control-tower"],
      actions: ["cmdb.write", "cmdb.update", "cmdb.delete", "ci.modify"],
      immutable: true,
    },
    {
      stableRuleId: "servicenow-ai-control-tower.actions.warn_production_system_change",
      title:
        "Warn when an agent action targets a production-classified configuration item or system",
      effect: "WARN",
      domains: ["actions", "production"],
      connectors: ["servicenow-ai-control-tower"],
      actions: ["ci.modify", "incident.create", "change.execute", "workflow.trigger"],
      immutable: true,
    },
    {
      stableRuleId: "servicenow-ai-control-tower.delegation.warn_external_agent_invocation",
      title:
        "Warn when Action Fabric routes a task to an agent built outside the ServiceNow platform",
      effect: "WARN",
      domains: ["delegation", "agent-calls"],
      connectors: ["servicenow-ai-control-tower"],
      actions: ["agent.delegate", "action_fabric.invoke", "mcp.call"],
      immutable: true,
    },
    {
      stableRuleId: "servicenow-ai-control-tower.desktop.warn_arc_autonomous_execution",
      title:
        "Warn when Project Arc executes a multi-step desktop automation without a human checkpoint",
      effect: "WARN",
      domains: ["actions", "agent-calls"],
      connectors: ["servicenow-ai-control-tower"],
      actions: ["desktop.execute", "automation.run", "arc.task"],
      immutable: false,
    },
    {
      stableRuleId: "servicenow-ai-control-tower.provenance.warn_gap",
      title: "Warn on ServiceNow events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["servicenow-ai-control-tower"],
      actions: ["agent.dispatch", "action_fabric.invoke", "workflow.trigger"],
      immutable: false,
    },
  ],
};

export const GEMINI_ENTERPRISE_AGENT_PLATFORM_PACK: PolicyPack = {
  id: "gemini-enterprise-agent-platform-v1",
  name: "Google Gemini Enterprise Agent Platform Governance Pack",
  connector: "gemini-enterprise-agent-platform",
  description:
    "Governance rules for agents managed through the Google Gemini Enterprise Agent Platform (formerly Vertex AI Agent Builder). Flags unregistered agent identities, warns on unapproved external tool invocations via Agent Gateway, surfaces data access without sensitivity classification, enforces per-session spend caps, and marks evidence with a provenance gap indicator — reflecting that the platform does not natively emit AGT-compatible evidence.",
  riskLevel: "MEDIUM",
  tags: [
    "google",
    "gemini",
    "vertex-ai",
    "agent-registry",
    "agent-gateway",
    "orchestration",
    "gcp",
  ],
  domains: ["requests", "agent-calls", "routing", "cost", "data"],
  metadata: {
    name: "Google Gemini Enterprise Agent Platform Governance Pack",
    version: "1.0.0",
    connector: "gemini-enterprise-agent-platform",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "MEDIUM",
    riskTags: ["google", "gemini", "gcp", "agent-registry"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "GOOGLE_ADK", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: unregistered agent identity, unapproved external tool, data sensitivity, spend cap, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "gemini-enterprise-agent-platform.identity.warn_unregistered_agent",
      title: "Warn when an agent operating through Agent Gateway is absent from the Agent Registry",
      effect: "WARN",
      domains: ["agent-calls", "routing"],
      connectors: ["gemini-enterprise-agent-platform"],
      actions: ["agent.dispatch", "agent.invoke", "gateway.route"],
      immutable: true,
    },
    {
      stableRuleId: "gemini-enterprise-agent-platform.routing.warn_external_tool_unapproved",
      title:
        "Warn when Agent Gateway routes to an external tool or API not in the approved tool registry",
      effect: "WARN",
      domains: ["routing", "agent-calls"],
      connectors: ["gemini-enterprise-agent-platform"],
      actions: ["tool.invoke", "api.call", "gateway.route"],
      immutable: false,
    },
    {
      stableRuleId: "gemini-enterprise-agent-platform.data.warn_sensitivity_unclassified",
      title:
        "Warn when an agent accesses GCP data resources without a declared sensitivity classification",
      effect: "WARN",
      domains: ["data", "agent-calls"],
      connectors: ["gemini-enterprise-agent-platform"],
      actions: ["data.read", "bigquery.query", "gcs.read", "data.unclassified"],
      immutable: false,
    },
    {
      stableRuleId: "gemini-enterprise-agent-platform.cost.block_high_spend",
      title: "Block Gemini API calls exceeding the per-session spend cap",
      effect: "DENY",
      domains: ["cost", "requests"],
      connectors: ["gemini-enterprise-agent-platform"],
      actions: ["llm_call", "chat.completions", "completions"],
      immutable: true,
    },
    {
      stableRuleId: "gemini-enterprise-agent-platform.provenance.warn_gap",
      title:
        "Warn on Gemini Enterprise Agent Platform events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "routing"],
      connectors: ["gemini-enterprise-agent-platform"],
      actions: ["agent.dispatch", "llm_call", "tool.invoke"],
      immutable: false,
    },
  ],
};

export const AZURE_AI_FOUNDRY_PACK: PolicyPack = {
  id: "azure-ai-foundry-v1",
  name: "Azure AI Foundry Governance Pack",
  connector: "azure-ai-foundry",
  description:
    "Governance rules for agents deployed through Azure AI Foundry. Warns when Prompt Shields content safety evaluation is bypassed or exceeds threshold, flags deployments referencing unapproved models, surfaces RAG pipeline access to unclassified data sources, enforces per-deployment spend caps, and marks evidence with a provenance gap indicator — reflecting that Azure AI Foundry does not natively emit AGT-compatible evidence.",
  riskLevel: "MEDIUM",
  tags: ["microsoft", "azure", "ai-foundry", "prompt-shields", "rag", "safety", "orchestration"],
  domains: ["requests", "agent-calls", "data", "safety", "cost"],
  metadata: {
    name: "Azure AI Foundry Governance Pack",
    version: "1.0.0",
    connector: "azure-ai-foundry",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "MEDIUM",
    riskTags: ["microsoft", "azure", "ai-foundry", "safety"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "AUTOGEN", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: Prompt Shields bypass, unapproved model deployment, RAG sensitivity, spend cap, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "azure-ai-foundry.safety.warn_prompt_shield_bypass",
      title:
        "Warn when an agent request bypasses or scores above threshold on Prompt Shields content safety",
      effect: "WARN",
      domains: ["safety", "requests"],
      connectors: ["azure-ai-foundry"],
      actions: ["llm_call", "chat.completions", "safety.eval"],
      immutable: true,
    },
    {
      stableRuleId: "azure-ai-foundry.models.warn_unapproved_deployment",
      title:
        "Warn when an agent deployment references a model not in the workspace-approved model registry",
      effect: "WARN",
      domains: ["agent-calls", "requests"],
      connectors: ["azure-ai-foundry"],
      actions: ["deployment.create", "deployment.invoke", "model.select"],
      immutable: false,
    },
    {
      stableRuleId: "azure-ai-foundry.data.warn_rag_sensitivity_unclassified",
      title:
        "Warn when a RAG pipeline retrieves from a data source without a declared sensitivity classification",
      effect: "WARN",
      domains: ["data", "agent-calls"],
      connectors: ["azure-ai-foundry"],
      actions: ["rag.retrieve", "index.search", "data.read", "data.unclassified"],
      immutable: false,
    },
    {
      stableRuleId: "azure-ai-foundry.cost.block_high_spend",
      title: "Block Azure OpenAI calls exceeding the per-deployment spend cap",
      effect: "DENY",
      domains: ["cost", "requests"],
      connectors: ["azure-ai-foundry"],
      actions: ["llm_call", "chat.completions", "completions"],
      immutable: true,
    },
    {
      stableRuleId: "azure-ai-foundry.provenance.warn_gap",
      title: "Warn on Azure AI Foundry events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["azure-ai-foundry"],
      actions: ["agent.dispatch", "llm_call", "rag.retrieve"],
      immutable: false,
    },
  ],
};

export const AMAZON_BEDROCK_AGENTS_PACK: PolicyPack = {
  id: "amazon-bedrock-agents-v1",
  name: "Amazon Bedrock Agents Governance Pack",
  connector: "amazon-bedrock-agents",
  description:
    "Governance rules for agents deployed through Amazon Bedrock Agents. Warns when action group Lambda functions carry broad IAM permissions, detects Bedrock Guardrail topic policy bypasses, surfaces knowledge base retrievals from unclassified data sources, enforces per-session spend caps, and marks evidence with a provenance gap indicator — reflecting that Bedrock Agents does not natively emit AGT-compatible evidence.",
  riskLevel: "MEDIUM",
  tags: [
    "aws",
    "amazon",
    "bedrock",
    "lambda",
    "guardrails",
    "knowledge-base",
    "rag",
    "orchestration",
  ],
  domains: ["requests", "agent-calls", "actions", "data", "cost"],
  metadata: {
    name: "Amazon Bedrock Agents Governance Pack",
    version: "1.0.0",
    connector: "amazon-bedrock-agents",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "MEDIUM",
    riskTags: ["aws", "bedrock", "lambda", "iam"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "LANGCHAIN", "AUTOGEN", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: Lambda IAM blast radius, Guardrail bypass, knowledge base sensitivity, spend cap, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "amazon-bedrock-agents.actions.warn_lambda_high_blast_radius",
      title: "Warn when an action group invokes a Lambda function with broad IAM permissions",
      effect: "WARN",
      domains: ["actions", "agent-calls"],
      connectors: ["amazon-bedrock-agents"],
      actions: ["lambda.invoke", "action_group.execute", "tool.execute"],
      immutable: true,
    },
    {
      stableRuleId: "amazon-bedrock-agents.guardrails.warn_policy_bypass",
      title:
        "Warn when an agent response bypasses or scores above threshold on a Bedrock Guardrail topic policy",
      effect: "WARN",
      domains: ["agent-calls", "requests"],
      connectors: ["amazon-bedrock-agents"],
      actions: ["guardrail.bypass", "guardrail.override", "llm_call"],
      immutable: true,
    },
    {
      stableRuleId: "amazon-bedrock-agents.data.warn_kb_sensitivity_unclassified",
      title:
        "Warn when a knowledge base retrieval accesses data without a declared sensitivity classification",
      effect: "WARN",
      domains: ["data", "agent-calls"],
      connectors: ["amazon-bedrock-agents"],
      actions: ["kb.retrieve", "rag.retrieve", "data.read", "data.unclassified"],
      immutable: false,
    },
    {
      stableRuleId: "amazon-bedrock-agents.cost.block_high_spend",
      title: "Block Bedrock API calls exceeding the per-session spend cap",
      effect: "DENY",
      domains: ["cost", "requests"],
      connectors: ["amazon-bedrock-agents"],
      actions: ["llm_call", "chat.completions", "completions"],
      immutable: true,
    },
    {
      stableRuleId: "amazon-bedrock-agents.provenance.warn_gap",
      title: "Warn on Bedrock Agents events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["amazon-bedrock-agents"],
      actions: ["agent.invoke", "llm_call", "kb.retrieve"],
      immutable: false,
    },
  ],
};

export const IBM_WATSONX_ORCHESTRATE_PACK: PolicyPack = {
  id: "ibm-watsonx-orchestrate-v1",
  name: "IBM watsonx Orchestrate Governance Pack",
  connector: "ibm-watsonx-orchestrate",
  description:
    "Governance rules for agents deployed through IBM watsonx Orchestrate. Warns when agent skills write to ERP or financial systems without an approved task record, flags access to business data without sensitivity or data residency classification, surfaces cross-system skill handoffs to undeclared catalog entries, enforces per-session spend caps, and marks evidence with a provenance gap indicator — reflecting that watsonx Orchestrate does not natively emit AGT-compatible evidence.",
  riskLevel: "HIGH",
  tags: [
    "ibm",
    "watsonx",
    "orchestrate",
    "erp",
    "finance",
    "data-residency",
    "regulated",
    "orchestration",
  ],
  domains: ["requests", "agent-calls", "actions", "data", "delegation"],
  metadata: {
    name: "IBM watsonx Orchestrate Governance Pack",
    version: "1.0.0",
    connector: "ibm-watsonx-orchestrate",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "HIGH",
    riskTags: ["ibm", "watsonx", "erp", "finance", "data-residency"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 2,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: ERP write block, data sensitivity/residency, cross-system skill handoff, spend cap, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "ibm-watsonx-orchestrate.actions.warn_erp_write_unapproved",
      title:
        "Warn when an agent skill writes to an ERP or financial system without a corresponding approved task",
      effect: "WARN",
      domains: ["actions", "agent-calls"],
      connectors: ["ibm-watsonx-orchestrate"],
      actions: ["skill.invoke", "erp.write", "finance.write", "workflow.trigger"],
      immutable: true,
    },
    {
      stableRuleId: "ibm-watsonx-orchestrate.data.warn_sensitivity_unclassified",
      title:
        "Warn when an agent skill accesses business data without a declared sensitivity or data residency classification",
      effect: "WARN",
      domains: ["data", "agent-calls"],
      connectors: ["ibm-watsonx-orchestrate"],
      actions: ["data.read", "skill.invoke", "data.unclassified"],
      immutable: false,
    },
    {
      stableRuleId: "ibm-watsonx-orchestrate.delegation.warn_cross_system_handoff",
      title:
        "Warn when orchestration routes a task to a skill or API not declared in the approved tool catalog",
      effect: "WARN",
      domains: ["delegation", "agent-calls"],
      connectors: ["ibm-watsonx-orchestrate"],
      actions: ["agent.delegate", "skill.invoke", "api.call"],
      immutable: true,
    },
    {
      stableRuleId: "ibm-watsonx-orchestrate.cost.block_high_spend",
      title: "Block watsonx API calls exceeding the per-session spend cap",
      effect: "DENY",
      domains: ["cost", "requests"],
      connectors: ["ibm-watsonx-orchestrate"],
      actions: ["llm_call", "chat.completions", "completions"],
      immutable: true,
    },
    {
      stableRuleId: "ibm-watsonx-orchestrate.provenance.warn_gap",
      title: "Warn on watsonx Orchestrate events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["ibm-watsonx-orchestrate"],
      actions: ["agent.dispatch", "skill.invoke", "llm_call"],
      immutable: false,
    },
  ],
};

export const KORE_AI_PACK: PolicyPack = {
  id: "kore-ai-v1",
  name: "Kore.ai Governance Pack",
  connector: "kore-ai",
  description:
    "Governance rules for agents deployed through the Kore.ai enterprise agent platform. Warns when session content contains unclassified PII, flags handoffs to agents or skills absent from the approved catalog, surfaces external API invocations not declared in the integration registry, escalates long-running sessions without a human checkpoint, and marks evidence with a provenance gap indicator — reflecting that Kore.ai does not natively emit AGT-compatible evidence.",
  riskLevel: "MEDIUM",
  tags: ["kore-ai", "contact-center", "cx", "pii", "handoff", "session", "orchestration"],
  domains: ["requests", "agent-calls", "data", "delegation", "session"],
  metadata: {
    name: "Kore.ai Governance Pack",
    version: "1.0.0",
    connector: "kore-ai",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "MEDIUM",
    riskTags: ["kore-ai", "pii", "cx", "session"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["AGT_PREVIEW", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-12",
        summary:
          "Initial pack: PII sensitivity gap, unverified agent handoff, external API invocation, long-running session, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "kore-ai.data.warn_pii_unclassified",
      title:
        "Warn when session content contains potential PII without a declared sensitivity classification",
      effect: "WARN",
      domains: ["data", "agent-calls"],
      connectors: ["kore-ai"],
      actions: ["session.message", "data.read", "data.unclassified"],
      immutable: true,
    },
    {
      stableRuleId: "kore-ai.handoff.warn_cross_agent_unverified",
      title:
        "Warn when an agent handoff routes to an agent or skill absent from the approved catalog",
      effect: "WARN",
      domains: ["delegation", "agent-calls"],
      connectors: ["kore-ai"],
      actions: ["agent.handoff", "agent.delegate", "skill.invoke"],
      immutable: true,
    },
    {
      stableRuleId: "kore-ai.actions.warn_external_api_unapproved",
      title:
        "Warn when an agent invokes an external API or webhook not declared in the integration registry",
      effect: "WARN",
      domains: ["actions", "agent-calls"],
      connectors: ["kore-ai"],
      actions: ["api.call", "webhook.invoke", "integration.call"],
      immutable: false,
    },
    {
      stableRuleId: "kore-ai.session.warn_long_running",
      title:
        "Warn on sessions that accumulate an unusually high turn count or duration without a human checkpoint",
      effect: "WARN",
      domains: ["session", "agent-calls"],
      connectors: ["kore-ai"],
      actions: ["session.call", "session.turn", "agent.action"],
      immutable: false,
    },
    {
      stableRuleId: "kore-ai.provenance.warn_gap",
      title: "Warn on Kore.ai events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["kore-ai"],
      actions: ["session.message", "agent.dispatch", "api.call"],
      immutable: false,
    },
  ],
};

export const NOTION_ORCHESTRATION_PACK: PolicyPack = {
  id: "notion-orchestration-v1",
  name: "Notion Orchestration Governance Pack",
  connector: "notion-orchestration",
  description:
    "Governance rules for agents orchestrated through Notion's External Agents API, Notion Workers, and Agent SDK embeds. Enforces per-call spend caps, warns on unverified agent routing, flags Worker write actions without a recorded human approval checkpoint, escalates Agent SDK embeds dispatching from external surfaces, and surfaces provenance gaps — reflecting that Notion does not natively emit AGT-compatible evidence.",
  riskLevel: "HIGH",
  tags: [
    "notion",
    "orchestration",
    "external-agents-api",
    "workers",
    "agent-sdk",
    "webhook",
    "enterprise",
  ],
  domains: ["requests", "agent-calls", "routing", "worker-execution", "delegation"],
  metadata: {
    name: "Notion Orchestration Governance Pack",
    version: "1.0.0",
    connector: "notion-orchestration",
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: "HIGH",
    riskTags: ["notion", "orchestration", "external-agents-api", "worker-execution"],
    generated: false,
    category: "Enterprise orchestration governance",
    compatibilityTargets: ["CREWAI", "LANGCHAIN", "OPENAI_AGENTS", "AUTOGEN", "CUSTOM"],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: 1,
    changelog: [
      {
        version: "1.0.0",
        date: "2026-05-18",
        summary:
          "Initial pack: spend cap, unverified agent routing, Worker write without approval checkpoint, cross-surface Agent SDK embed, unapproved webhook downstream connector, and provenance gap rules.",
      },
    ],
  },
  rules: [
    {
      stableRuleId: "notion-orchestration.cost.block_high_spend",
      title: "Block agent routing decisions exceeding per-call spend cap",
      effect: "DENY",
      domains: ["cost", "requests"],
      connectors: ["notion-orchestration"],
      actions: ["llm_call", "agent.dispatch", "agent.action"],
      immutable: true,
    },
    {
      stableRuleId: "notion-orchestration.routing.warn_unverified_agent",
      title:
        "Warn when the External Agents API routes to an agent not in the workspace-approved agent list",
      effect: "WARN",
      domains: ["routing", "agent-calls"],
      connectors: ["notion-orchestration"],
      actions: ["routing.agent_select", "agent.dispatch", "agent.route"],
      immutable: false,
    },
    {
      stableRuleId: "notion-orchestration.worker.warn_write_without_approval",
      title:
        "Warn when a Notion Worker executes a write action to an external system without a recorded human approval checkpoint",
      effect: "WARN",
      domains: ["worker-execution", "agent-calls"],
      connectors: ["notion-orchestration"],
      actions: ["worker.execute", "worker.action", "action.write", "action.delete", "action.send"],
      immutable: true,
    },
    {
      stableRuleId: "notion-orchestration.agent-sdk.warn_cross_surface_embed",
      title: "Warn when an Agent SDK embed dispatches an agent action from an external surface",
      effect: "WARN",
      domains: ["delegation", "agent-calls"],
      connectors: ["notion-orchestration"],
      actions: ["agent.embed_dispatch", "agent.external_surface", "agent.action"],
      immutable: true,
    },
    {
      stableRuleId: "notion-orchestration.webhook.warn_unapproved_downstream",
      title:
        "Warn when an incoming webhook triggers a Worker that calls a downstream connector not in the workspace allowlist",
      effect: "WARN",
      domains: ["requests", "worker-execution"],
      connectors: ["notion-orchestration"],
      actions: ["webhook.trigger", "worker.execute", "action.external_api"],
      immutable: false,
    },
    {
      stableRuleId: "notion-orchestration.provenance.warn_gap",
      title:
        "Warn on Notion orchestration events where Spctre policy context could not be resolved",
      effect: "WARN",
      domains: ["requests", "agent-calls"],
      connectors: ["notion-orchestration"],
      actions: ["agent.dispatch", "worker.execute", "agent.action"],
      immutable: false,
    },
  ],
};
