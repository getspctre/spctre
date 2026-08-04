import type { SpctreCliConfig } from "./config";
import { requireConfig } from "./config";
import { writeCrewAiAdapter } from "./frameworks/crewai";
import { writeLangChainAdapter } from "./frameworks/langchain";
import { writeNotionWorkerAdapter } from "./frameworks/notion-worker";
import { writeOpenAiAgentsAdapter } from "./frameworks/openai-agents";
import { writeAutoGenAdapter } from "./frameworks/autogen";
import { writeGoogleAdkAdapter } from "./frameworks/google-adk";
import { writeStrandsAdapter } from "./frameworks/strands";
import { writeAntigravitySdkAdapter } from "./frameworks/antigravity-sdk";
import { writeClaudeAgentSdkAdapter } from "./frameworks/claude-agent-sdk";
import { writeAzureAiAdapter } from "./frameworks/azure-ai";
import { writeBedrockAdapter } from "./frameworks/bedrock";
import { writeGeminiAdapter } from "./frameworks/gemini";
import { writeLocalCustomAdapter } from "./frameworks/local-custom";
import { writeOmnigentAdapter } from "./frameworks/omnigent";

interface FrameworkAdapterStrategy {
  names: string[];
  writtenMessage: string;
  launchMessage: string;
  details: string[];
  write(config: SpctreCliConfig): { adapterPath: string; launchHint: string };
}

const frameworkAdapters: FrameworkAdapterStrategy[] = [
  {
    names: ["crewai"],
    writtenMessage: "CrewAI adapter written to",
    launchMessage: "Launch your CrewAI agent with zero code changes:",
    details: [
      "The adapter patches crewai.tools.BaseTool._run at Python startup and emits",
      "Spctre evidence for every tool call. No changes to your agent source needed.",
    ],
    write: writeCrewAiAdapter,
  },
  {
    names: ["langchain", "langgraph"],
    writtenMessage: "LangChain/LangGraph adapter written to",
    launchMessage: "Launch your LangChain or LangGraph agent with zero code changes:",
    details: [
      "The adapter patches BaseTool.invoke and BaseTool.ainvoke at Python startup",
      "and emits Spctre evidence for every tool call. runtimeTarget.stack is set",
      "to LANGGRAPH automatically when langgraph is installed. No source changes needed.",
    ],
    write: writeLangChainAdapter,
  },
  {
    names: ["openai-agents", "openai_agents"],
    writtenMessage: "OpenAI Agents SDK adapter written to",
    launchMessage: "Launch your OpenAI Agents SDK agent with zero code changes:",
    details: [
      "The adapter patches FunctionTool.on_invoke_tool at Python startup and emits",
      "Spctre evidence for every tool call. No source changes needed.",
    ],
    write: writeOpenAiAgentsAdapter,
  },
  {
    names: ["autogen"],
    writtenMessage: "AutoGen adapter written to",
    launchMessage: "Launch your AutoGen agent with zero code changes:",
    details: [
      "The adapter supports both AutoGen v0.4+ (autogen_core.tools.FunctionTool)",
      "and v0.2 (autogen.ConversableAgent), trying v0.4 first. No source changes needed.",
    ],
    write: writeAutoGenAdapter,
  },
  {
    names: ["google-adk", "google_adk"],
    writtenMessage: "Google ADK adapter written to",
    launchMessage: "Launch your Google ADK agent with zero code changes:",
    details: [
      "The adapter patches BaseTool.run_async at Python startup and emits",
      "Spctre evidence for every tool call. No source changes needed.",
    ],
    write: writeGoogleAdkAdapter,
  },
  {
    names: ["bedrock", "aws-bedrock", "aws_bedrock"],
    writtenMessage: "AWS Bedrock adapter written to",
    launchMessage: "Launch your Bedrock agent with zero code changes:",
    details: [
      "The adapter patches boto3 Bedrock Runtime clients at Python startup",
      "and emits Spctre evidence for invoke_model and converse calls.",
    ],
    write: writeBedrockAdapter,
  },
  {
    names: ["azure-ai", "azure_ai", "azure-openai", "azure_openai"],
    writtenMessage: "Azure AI adapter written to",
    launchMessage: "Launch your Azure AI agent with zero code changes:",
    details: [
      "The adapter patches Azure OpenAI chat completions at Python startup",
      "and emits Spctre evidence for each model call.",
    ],
    write: writeAzureAiAdapter,
  },
  {
    names: ["gemini", "google-gemini", "google_gemini"],
    writtenMessage: "Gemini adapter written to",
    launchMessage: "Launch your Gemini agent with zero code changes:",
    details: [
      "The adapter patches google.generativeai GenerativeModel calls at Python startup",
      "and emits Spctre evidence for generate_content calls.",
    ],
    write: writeGeminiAdapter,
  },
  {
    names: ["claude", "codex", "local", "custom", "local-custom", "local_custom"],
    writtenMessage: "Local/custom adapter written to",
    launchMessage: "Launch your local or custom agent with zero code changes:",
    details: [
      "The adapter provides a Python helper for custom runtimes and emits LOCAL",
      "evidence. Claude Code and Codex users should prefer install-hook for native harness governance.",
    ],
    write: writeLocalCustomAdapter,
  },
  {
    names: ["strands"],
    writtenMessage: "Strands Agents adapter written to",
    launchMessage: "Launch your Strands agent with zero code changes:",
    details: [
      "The adapter intercepts at ToolHandler.process (with FunctionTool.__call__",
      "fallback) and emits Spctre evidence for every tool call. No source changes needed.",
    ],
    write: writeStrandsAdapter,
  },
  {
    names: ["notion-worker", "notion_worker"],
    writtenMessage: "Notion Worker governance template written to",
    launchMessage: "Deploy your governed Notion Worker:",
    details: [
      "The template wraps each tool call with spctreGoverned(), calling evaluate_policy",
      "before execution. On ESCALATE the Notion approval loop URL is returned to defer",
      "execution to a human reviewer. Evidence is posted to /api/gateway-ingest/notion",
      "after each call. Replace the placeholder handler logic with your agent tool calls.",
    ],
    write: writeNotionWorkerAdapter,
  },
  {
    names: ["antigravity-sdk", "antigravity_sdk", "google-antigravity", "google_antigravity"],
    writtenMessage: "Google Antigravity SDK adapter written to",
    launchMessage: "Launch your Google Antigravity SDK agent with zero code changes:",
    details: [
      "The adapter patches google.antigravity.tools.tool_runner.ToolRunner.execute",
      "and process_tool_calls at Python startup, emitting Spctre evidence for every",
      "SDK tool call. The Antigravity CLI (agy) is governed separately with install-hook.",
      "Set SPCTRE_ANTIGRAVITY_SDK_MODE=enforce for native gateway enforcement.",
    ],
    write: writeAntigravitySdkAdapter,
  },
  {
    names: ["claude-agent-sdk", "claude_agent_sdk"],
    writtenMessage: "Claude Agent SDK adapter written to",
    launchMessage: "Launch your Claude Agent SDK agent with zero code changes:",
    details: [
      "The adapter injects native PreToolUse, PostToolUse, and PostToolUseFailure",
      "hooks into ClaudeAgentOptions at Python startup and emits Spctre evidence.",
      "Set SPCTRE_CLAUDE_AGENT_SDK_MODE=enforce for native gateway enforcement.",
    ],
    write: writeClaudeAgentSdkAdapter,
  },
  {
    names: ["omnigent"],
    writtenMessage: "Omnigent policy adapter written to",
    launchMessage:
      "Configure Omnigent to use Spctre policies by adding this module to your python path:",
    details: [
      "The adapter exports a custom Omnigent policy function that delegates",
      "governed tool-call decisions to the Spctre evaluate endpoint.",
      "Set PYTHONPATH to include .spctre, register 'spctre_policy' in server_config.yaml,",
      "and configure policies with handler 'spctre_policy.spctre_policy'.",
    ],
    write: writeOmnigentAdapter,
  },
];

export function runFrameworkAdapter(frameworkName: string) {
  const framework = frameworkName.toLowerCase();
  const adapter = frameworkAdapters.find((strategy) => strategy.names.includes(framework));
  if (!adapter) {
    console.error(
      `Error: --framework "${frameworkName}" is not supported. Supported values: crewai, langchain, openai-agents, autogen, google-adk, bedrock, azure-ai, gemini, local-custom, strands, notion-worker, antigravity-sdk, claude-agent-sdk, omnigent`,
    );
    process.exit(1);
  }

  const { adapterPath, launchHint } = adapter.write(requireConfig());
  console.log(`${adapter.writtenMessage} ${adapterPath}`);
  console.log("");
  console.log(adapter.launchMessage);
  console.log(`  ${launchHint}`);
  console.log("");
  for (const detail of adapter.details) {
    console.log(detail);
  }
  console.log("");
}
