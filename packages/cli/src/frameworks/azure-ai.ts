import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

export function writeAzureAiAdapter(config: SpctreCliConfig): { adapterPath: string; launchHint: string } {
  return writePythonAdapterFromTemplate(config, {
    framework: "azure-ai",
    templateName: "azure-ai.py",
  });
}
