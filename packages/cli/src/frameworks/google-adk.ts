import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py that patches google.adk.tools.BaseTool.run_async
 * to emit Spctre evidence on every tool call made through Google ADK agents.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 */
export function writeGoogleAdkAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "google-adk",
    templateName: "google-adk.py",
  });
}
