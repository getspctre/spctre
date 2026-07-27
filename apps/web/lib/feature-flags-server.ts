import { getStringEnv } from "@/lib/platform/config";
import {
  getFeatureFlagSnapshot,
  isFeatureEnabledForPlan,
  normalizeSpctrePlan,
  type FeatureFlag,
  type FeatureFlagSnapshot,
  type SpctrePlan
} from "./feature-flags";

export function getSpctrePlan(): SpctrePlan {
  return normalizeSpctrePlan(getStringEnv("SPCTRE_PLAN", "oss"));
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return isFeatureEnabledForPlan(flag, getSpctrePlan());
}

export function getServerFeatureFlags(): FeatureFlagSnapshot {
  return getFeatureFlagSnapshot(getSpctrePlan());
}
