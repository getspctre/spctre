import type { SpctreCliConfig } from "../config";
import { writePythonAdapterFromTemplate } from "./template";

export function writeLocalCustomAdapter(config: SpctreCliConfig): {
  adapterPath: string;
  launchHint: string;
} {
  return writePythonAdapterFromTemplate(config, {
    framework: "local-custom",
    templateName: "local-custom.py",
  });
}
