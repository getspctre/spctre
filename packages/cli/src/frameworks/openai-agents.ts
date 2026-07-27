import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py that patches agents.FunctionTool.on_invoke_tool
 * to emit Spctre evidence on every tool call made through the OpenAI Agents SDK.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 */
export function writeOpenAiAgentsAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "openai-agents",
    templateName: "openai-agents.py",
  });
}
