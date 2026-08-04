// OSS slot adapter — resolved dynamically or replaced during commercial builds.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { loadCommercialSlot } from "./slot-loader";

export interface ArchivalRecord {
  decisionId: string;
  workspaceId: string;
  tenantId: string;
  payload: unknown;
  retainUntil: Date;
}

export interface ArchivalResult {
  archivalId: string;
  storedAt: string;
}

export interface PruneResult {
  pruned: number;
}

export interface ArchivalService {
  store(record: ArchivalRecord): Promise<ArchivalResult>;
  retrieve(archivalId: string): Promise<ArchivalRecord | null>;
  prune(workspaceId: string, tenantId: string): Promise<PruneResult>;
  verifyLedgerChain?(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ ok: boolean; error?: string; verifiedCount: number }>;
}

// Resilient slot loader that avoids static imports of ee/ to pass OSS boundary checks
async function loadArchivalService(): Promise<ArchivalService> {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return fallbackService;
  }

  try {
    const module = await loadCommercialSlot<{ archivalService: ArchivalService }>(
      "web/archival/index.js",
    );
    return module.archivalService;
  } catch (err) {
    logger.warn(
      "Failed to load commercial Forensic Archival slot implementation; using fallback.",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return fallbackService;
  }
}

const fallbackService: ArchivalService = {
  async store() {
    throw new Error(
      "Forensic archival is a premium Cloud feature and is not available on your plan.",
    );
  },
  async retrieve() {
    return null;
  },
  async prune() {
    return { pruned: 0 };
  },
};

export const archivalService: ArchivalService = {
  async store(record) {
    const service = await loadArchivalService();
    return service.store(record);
  },
  async retrieve(archivalId) {
    const service = await loadArchivalService();
    return service.retrieve(archivalId);
  },
  async prune(workspaceId, tenantId) {
    const service = await loadArchivalService();
    return service.prune(workspaceId, tenantId);
  },
  async verifyLedgerChain(tenantId, workspaceId) {
    const service = await loadArchivalService();
    if (service.verifyLedgerChain) {
      return service.verifyLedgerChain(tenantId, workspaceId);
    }
    return { ok: true, verifiedCount: 0 };
  },
};
