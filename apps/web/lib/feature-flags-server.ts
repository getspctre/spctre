import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  getFeatureFlagSnapshot,
  isFeatureEnabledForPlan,
  normalizeSpctrePlan,
  type FeatureFlag,
  type FeatureFlagSnapshot,
  type SpctrePlan,
} from "./feature-flags";

export function getSpctrePlan(): SpctrePlan {
  return getRuntimeConfig().plan;
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return isFeatureEnabledForPlan(flag, getSpctrePlan());
}

export function getServerFeatureFlags(): FeatureFlagSnapshot {
  return getFeatureFlagSnapshot(getSpctrePlan());
}
