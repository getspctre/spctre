import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

export function writeGeminiAdapter(config: SpctreCliConfig): {
  adapterPath: string;
  launchHint: string;
} {
  return writePythonAdapterFromTemplate(config, { framework: "gemini", templateName: "gemini.py" });
}
