import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py that patches AutoGen tool execution to emit
 * Spctre evidence on every tool call.
 *
 * Supports both AutoGen v0.4+ (autogen_core.tools.FunctionTool.run_json) and
 * AutoGen v0.2 (autogen.ConversableAgent.execute_function), trying v0.4 first.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 */
export function writeAutoGenAdapter(config: SpctreCliConfig): {
  adapterPath: string;
  launchHint: string;
} {
  return writePythonAdapterFromTemplate(config, {
    framework: "autogen",
    templateName: "autogen.py",
  });
}
