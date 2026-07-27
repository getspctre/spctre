import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py - a Python startup file that patches
 * crewai.tools.BaseTool._run/_arun to emit Spctre evidence on each tool invocation.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 *
 * No changes to agent source code are required.
 */
export function writeCrewAiAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "crewai",
    templateName: "crewai.py",
  });
}
