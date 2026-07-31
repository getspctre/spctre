import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Resolve a commercial runtime module from the location used by hosted
 * standalone images. This deliberately remains a dynamic import so OSS builds
 * do not require an `ee/` directory.
 */
export function commercialSlotModuleUrl(slotPath: string): string {
  return pathToFileURL(join(process.cwd(), "ee", slotPath)).href;
}

export async function loadCommercialSlot<T>(slotPath: string): Promise<T> {
  const moduleUrl = commercialSlotModuleUrl(slotPath);
  return await import(/* webpackIgnore: true */ moduleUrl) as T;
}
