import { CheckCircle2, Clock3, XCircle } from "lucide-react";

export const runtimeLabels: Record<string, string> = {
  AWS_BEDROCK: "AWS Bedrock",
  GOOGLE_ADK: "Google ADK",
  AZURE_AI: "Azure AI",
  LANGCHAIN: "LangChain",
  LANGGRAPH: "LangGraph",
  CREWAI: "CrewAI",
  AUTOGEN: "AutoGen",
  OPENAI_AGENTS: "OpenAI Agents",
  OMNIGENT: "Omnigent",
  OPENCODE: "OpenCode",
  CLAUDE_CODE: "Claude Code",
  LOCAL: "Local",
  CUSTOM: "Custom",
};

export const diffPillClass: Record<string, string> = {
  ADDED: "pill pillAllow",
  MODIFIED: "pill pillWarn",
  REMOVED: "pill pillBlock",
  UNCHANGED: "pill",
};

export const approvalPillClass: Record<string, string> = {
  APPROVED: "pill pillAllow",
  PENDING: "pill pillWarn",
  CHANGES_REQUESTED: "pill pillBlock",
};

export const approvalIcons = {
  APPROVED: CheckCircle2,
  PENDING: Clock3,
  CHANGES_REQUESTED: XCircle,
};

export const simulationPillClass: Record<string, string> = {
  NEWLY_DENIED: "pill pillBlock",
  NEWLY_ALLOWED: "pill pillAllow",
  UNCHANGED: "pill",
};
