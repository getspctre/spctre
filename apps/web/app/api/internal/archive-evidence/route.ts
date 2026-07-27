import { NextRequest, NextResponse } from "next/server";
import { workerInternalSecret } from "@/lib/platform/config";
import { archivalService } from "@/lib/ee-adapters/archival";
import { getCommercialProfile } from "@/lib/repositories/workspace";
import { getRawEvidenceForArchival } from "@/lib/repositories/evidence/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = workerInternalSecret();
  if (!secret) {
    return NextResponse.json({ error: "Worker secret not configured." }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { decisionIds, tenantId } = await req.json();
    if (!Array.isArray(decisionIds) || !decisionIds.length || !tenantId) {
      return NextResponse.json({ error: "Missing required parameters." }, { status: 400 });
    }

    // Retrieve the raw evidence records from the database
    const records = await getRawEvidenceForArchival(tenantId, decisionIds);

    if (!records.length) {
      return NextResponse.json({ ok: true, archived: 0 });
    }

    // Fetch tenant commercial profile to determine plan-based retention
    const profile = await getCommercialProfile(tenantId).catch(() => null);
    let retentionDays = 90;
    if (profile?.planCode === "TEAM") {
      retentionDays = 365;
    } else if (profile?.planCode === "BUSINESS") {
      retentionDays = 1095;
    } else if (profile?.planCode === "ENTERPRISE") {
      retentionDays = profile.retentionWindowDays ?? 2555;
    }
    const retainUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    let archivedCount = 0;
    for (const record of records) {
      try {
        await archivalService.store({
          decisionId: record.decision_id,
          workspaceId: record.workspace_id,
          tenantId: record.tenant_id,
          payload: record.raw_evidence,
          retainUntil
        });
        archivedCount++;
      } catch (err) {
        console.error(`[Internal Archival] Failed to archive ${record.decision_id}:`, err);
      }
    }

    return NextResponse.json({ ok: true, archived: archivedCount });
  } catch (err) {
    console.error("[Internal Archival Route Error]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
