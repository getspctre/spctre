// OSS slot adapter — resolved dynamically or replaced during commercial builds.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { loadCommercialSlot } from "./slot-loader";

export interface HitlAssignmentParams {
  queueId: string;
  principalId: string;
  tenantId: string;
  workspaceId: string;
}

export interface SlaBreachSummary {
  queueId: string;
  decisionId: string;
  tenantId: string;
  workspaceId: string;
  slaDueAt: string;
  overdueMs: number;
}

export interface HitlService {
  assign(params: HitlAssignmentParams): Promise<void>;
  calculateSla(tenantId: string, baseDate: Date, slaHours: number): Promise<Date>;
  checkSlaBreaches(workspaceId: string, tenantId: string): Promise<SlaBreachSummary[]>;
  notifyOnBreach(summary: SlaBreachSummary): Promise<void>;
}

async function loadHitlService(): Promise<HitlService> {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return fallbackService;
  }

  try {
    const module = await loadCommercialSlot<{ hitlService: HitlService }>("web/hitl/index.js");
    return module.hitlService;
  } catch (err) {
    logger.warn("Failed to load commercial Managed HITL slot implementation; using fallback.", { error: err instanceof Error ? err.message : String(err) });
    return fallbackService;
  }
}

const fallbackService: HitlService = {
  async assign() {
    throw new Error("Managed HITL assignments require a commercial Cloud or Enterprise subscription.");
  },
  async calculateSla(tenantId, baseDate, slaHours) {
    // Default fallback: static timezone-unaware math for OSS
    const result = new Date(baseDate);
    result.setHours(result.getHours() + slaHours);
    return result;
  },
  async checkSlaBreaches() {
    return [];
  },
  async notifyOnBreach() {
    // no-op for OSS
  }
};

export const hitlService: HitlService = {
  async assign(params) {
    const service = await loadHitlService();
    return service.assign(params);
  },
  async calculateSla(tenantId, baseDate, slaHours) {
    const service = await loadHitlService();
    return service.calculateSla(tenantId, baseDate, slaHours);
  },
  async checkSlaBreaches(workspaceId, tenantId) {
    const service = await loadHitlService();
    return service.checkSlaBreaches(workspaceId, tenantId);
  },
  async notifyOnBreach(summary) {
    const service = await loadHitlService();
    return service.notifyOnBreach(summary);
  }
};
