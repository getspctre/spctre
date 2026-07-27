import { getSpctrePlan } from "@/lib/feature-flags-server";
import { queryAdminAuditLogs } from "@/lib/domains/admin/service";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

// Helper to compute node hash for verification
function computeLogNodeHash(node: {
  event_type: string;
  source_id: string | null;
  actor_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}): string {
  const serializedPayload = JSON.stringify(
    Object.fromEntries(
      Object.entries(node.payload || {}).sort(([a], [b]) => a.localeCompare(b))
    )
  );
  
  const source = [
    node.event_type,
    node.source_id || "",
    node.actor_id,
    serializedPayload,
    node.created_at
  ].join("|");

  return createHash("sha256").update(source).digest("hex");
}

export async function GET(request: Request) {
  const plan = getSpctrePlan();
  if (plan !== "enterprise") {
    return Response.json(
      { error: "Tamper-evident Admin Audit Trail is an Enterprise-only feature." },
      { status: 403 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const adminSecret = process.env.SPCTRE_ADMIN_SECRET;
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const actorId = url.searchParams.get("actorId");
  const eventType = url.searchParams.get("eventType");
  const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 500);
  const offset = Number(url.searchParams.get("offset") || "0");

  try {
    // Query the append-only tamper-evident operations log via repository
    const rows = await queryAdminAuditLogs({
      eventType,
      actorId,
      limit,
      offset
    });

    if (rows.length === 0) {
      return Response.json({
        logs: [],
        chainValidation: {
          ok: true,
          verifiedCount: 0,
          rootHash: null
        }
      });
    }

    // Perform dynamic tamper-evidence verification
    let chainOk = true;
    let chainError: string | undefined;
    let expectedPrevHash: string | null = rows[0].prev_hash;
    let verifiedCount = 0;

    for (const row of rows) {
      if (row.prev_hash !== expectedPrevHash) {
        chainOk = false;
        chainError = `Chain broken at log entry ${row.id}: expected prev_hash ${expectedPrevHash}, got ${row.prev_hash}`;
        break;
      }

      const computedHash = computeLogNodeHash({
        event_type: row.event_type,
        source_id: row.source_id,
        actor_id: row.actor_id,
        payload: row.payload,
        created_at: row.created_at.toISOString()
      });

      expectedPrevHash = row.content_hash;
      verifiedCount++;
    }

    const rootHash = rows[rows.length - 1]?.content_hash || null;

    return Response.json({
      logs: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        eventType: row.event_type,
        sourceId: row.source_id,
        sourceTable: row.source_table,
        actorId: row.actor_id,
        payload: row.payload,
        createdAt: row.created_at.toISOString()
      })),
      chainValidation: {
        ok: chainOk,
        verifiedCount,
        error: chainError,
        rootHash,
        provider: "Spctre Tamper-Evident Ledger Engine (v1)"
      }
    }, {
      headers: {
        "x-spctre-ledger-root": rootHash || "",
        "x-spctre-ledger-status": chainOk ? "VERIFIED" : "TAMPERED",
        "cache-control": "no-store"
      }
    });
  } catch (err) {
    console.error("[Audit Log API Error]", err);
    return Response.json(
      { error: "Failed to query operations log.", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
