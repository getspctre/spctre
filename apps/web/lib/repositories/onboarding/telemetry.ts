import { logger } from "@spctre/platform/logging";
import type { JSONValue } from "postgres";
import { sql } from "@/lib/db";

export type ConversionTelemetryEventType =
  | "SIGNUP_COMPLETED"
  | "TRIAL_START"
  | "FIRST_EVIDENCE_INGEST"
  | "FIRST_COMPLIANCE_EXPORT"
  | "FIRST_HITL_ESCALATION"
  | "TRIAL_CONVERTED"
  | "TRIAL_EXPIRED"
  | "TRIAL_CANCELLED"
  | "SUBSCRIPTION_CANCELLED"
  | "PAYMENT_FAILED"
  | "PLAN_CHANGED";

// Keep this set in sync with the ON CONFLICT predicate below and the
// conversion_telemetry_first_occurrence_idx partial index in migration 026.
const FIRST_OCCURRENCE_EVENTS = new Set<ConversionTelemetryEventType>([
  "SIGNUP_COMPLETED",
  "TRIAL_START",
  "FIRST_EVIDENCE_INGEST",
  "FIRST_COMPLIANCE_EXPORT",
  "FIRST_HITL_ESCALATION",
  "TRIAL_CONVERTED",
]);

export async function recordConversionTelemetry(
  tenantId: string,
  eventType: ConversionTelemetryEventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!sql) return;
  try {
    // 1. Check if tenant has opted out of telemetry
    const optInRows = await sql<{ opt_in: boolean }[]>`
      SELECT opt_in FROM telemetry_setting WHERE tenant_id = ${tenantId} LIMIT 1
    `;
    const optIn = optInRows[0]?.opt_in !== false;
    if (!optIn) return;

    if (FIRST_OCCURRENCE_EVENTS.has(eventType)) {
      await sql`
        INSERT INTO conversion_telemetry_event (tenant_id, event_type, metadata)
        VALUES (${tenantId}, ${eventType}, ${sql.json(metadata as JSONValue)})
        ON CONFLICT (tenant_id, event_type)
        WHERE event_type IN (
          'SIGNUP_COMPLETED',
          'TRIAL_START',
          'FIRST_EVIDENCE_INGEST',
          'FIRST_COMPLIANCE_EXPORT',
          'FIRST_HITL_ESCALATION',
          'TRIAL_CONVERTED'
        )
        DO NOTHING
      `;
      return;
    }

    await sql`
      INSERT INTO conversion_telemetry_event (tenant_id, event_type, metadata)
      VALUES (${tenantId}, ${eventType}, ${sql.json(metadata as JSONValue)})
    `;
  } catch (err) {
    logger.error(`[telemetry] failed to record conversion event ${eventType}:`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
