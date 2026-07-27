import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py that patches Strands Agents tool execution
 * to emit Spctre evidence on every tool call, with zero changes to agent source.
 *
 * Strands tools are Python callables decorated with @tool. The adapter intercepts
 * at the ToolHandler level so all tool types (function tools, built-in tools) are covered.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 */
export function writeStrandsAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "strands",
    templateName: "strands.py",
  });
}
