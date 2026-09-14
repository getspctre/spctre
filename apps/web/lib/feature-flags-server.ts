import { getRuntimeConfig } from "@/lib/config/runtime";
import { normalizeSpctrePlan, type SpctrePlan } from "./feature-flags";

export function getSpctrePlan(): SpctrePlan {
  return getRuntimeConfig().plan;
}
