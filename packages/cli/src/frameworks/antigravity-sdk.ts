import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

/**
 * Generates .spctre/sitecustomize.py that patches the public Google Antigravity
 * Python SDK ToolRunner execution methods to emit Spctre evidence for every tool
 * call made through the SDK.
 *
 * Users run their agent with:
 *   .spctre/spctre-python python my_agent.py
 */
export function writeAntigravitySdkAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "antigravity-sdk",
    templateName: "antigravity-sdk.py",
  });
}
