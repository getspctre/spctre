import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

export function writeBedrockAdapter(config: SpctreCliConfig): {
  adapterPath: string;
  launchHint: string;
} {
  return writePythonAdapterFromTemplate(config, {
    framework: "bedrock",
    templateName: "bedrock.py",
  });
}
