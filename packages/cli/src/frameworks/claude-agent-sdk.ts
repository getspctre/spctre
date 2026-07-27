import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/** Generates a zero-code adapter using Claude Agent SDK native tool hooks. */
export function writeClaudeAgentSdkAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "claude-agent-sdk",
    templateName: "claude-agent-sdk.py",
  });
}
