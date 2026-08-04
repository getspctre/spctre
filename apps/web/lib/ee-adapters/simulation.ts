// OSS slot adapter — resolved dynamically or replaced during commercial builds.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { loadCommercialSlot } from "./slot-loader";
import type {
  PolicyRuleSummary,
  SimulationRegressionSummary,
  SimulationReplayInput,
} from "@spctre/policy-schema";

export interface SimulationCostSummary {
  newlyDeniedCount: number;
  newlyAllowedCount: number;
  unchangedCount: number;
  totalCostSavedUsd: number;
  totalLatencySavedMs: number;
  averageLatencySavedMs: number;
  sourceEventCount: number;
  results: SimulationReplayInput[];
  /** Produced by the managed retained-log worker, not inferred from a sample. */
  regressionSummary?: SimulationRegressionSummary;
}

export interface BulkSimulationService {
  runBulkSimulation(params: {
    tenantId: string;
    workspaceId: string | null;
    proposedRules: PolicyRuleSummary[];
  }): Promise<SimulationCostSummary>;
}

async function loadSimulationService(): Promise<BulkSimulationService> {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return fallbackService;
  }

  try {
    const module = await loadCommercialSlot<{ bulkSimulationService: BulkSimulationService }>(
      "web/simulation/index.js",
    );
    return module.bulkSimulationService;
  } catch (err) {
    logger.warn("Failed to load commercial Bulk Simulation slot implementation; using fallback.", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackService;
  }
}

const fallbackService: BulkSimulationService = {
  async runBulkSimulation() {
    throw new Error("Bulk simulation is a premium Cloud feature and requires a commercial plan.");
  },
};

export const bulkSimulationService: BulkSimulationService = {
  async runBulkSimulation(params) {
    const service = await loadSimulationService();
    return service.runBulkSimulation(params);
  },
};
