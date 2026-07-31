import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Resolve a commercial runtime module from the standalone image's default
 * `./ee` location, or from SPCTRE_COMMERCIAL_SLOTS_ROOT when a hosted image
 * runs with a different working directory. This deliberately remains a
 * dynamic import so OSS builds do not require an `ee/` directory.
 */
export function commercialSlotModuleUrl(slotPath: string): string {
  const slotRoot = process.env.SPCTRE_COMMERCIAL_SLOTS_ROOT || join(process.cwd(), "ee");
  return pathToFileURL(join(slotRoot, slotPath)).href;
}

export async function loadCommercialSlot<T>(slotPath: string): Promise<T> {
  const moduleUrl = commercialSlotModuleUrl(slotPath);
  return await import(/* webpackIgnore: true */ moduleUrl) as T;
}
