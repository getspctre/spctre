"use client";

import { createContext, useContext } from "react";
import type { FeatureFlag, FeatureFlagSnapshot, SpctrePlan } from "@/lib/feature-flags";

interface FeatureFlagContextValue {
  plan: SpctrePlan;
  flags: FeatureFlagSnapshot;
}

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

export function FeatureFlagProvider({
  children,
  flags,
  plan
}: {
  children: React.ReactNode;
  flags: FeatureFlagSnapshot;
  plan: SpctrePlan;
}) {
  return (
    <FeatureFlagContext.Provider value={{ flags, plan }}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const context = useContext(FeatureFlagContext);
  if (!context) return false;
  return Boolean(context.flags[flag]);
}
