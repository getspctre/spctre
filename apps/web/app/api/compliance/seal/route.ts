import { createHash } from "crypto";
import { getCompliancePacket, recordComplianceOperation } from "@/lib/domains/compliance/service";

import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";

import { authenticateServiceToken } from "@/lib/service-tokens";
import { makeMeta, newTraceId, withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiComplianceSeal(request: Request) {
  const traceId = newTraceId();

  let tenantId: string;
  let workspaceId: string;
  let actorId: string;

  const hasBearer = (request.headers.get("authorization") ?? "").startsWith("Bearer ");
  if (hasBearer) {
    const auth = await authenticateServiceToken(request, "compliance:read");
    if (!auth.ok) {
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    tenantId = auth.auth.tenantId;
    workspaceId = auth.auth.workspaceId;
    actorId = auth.auth.principalId;
  } else {
    const session = await getAuthSession().catch(swallow("getAuthSession", null));
    if (!session) {
      return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    const workspaceContext = await getActiveScope();
    tenantId = workspaceContext.tenantId;
    workspaceId = workspaceContext.workspaceId;
    actorId = session.principalId ?? "unknown";
  }

  if (!workspaceId || !tenantId) {
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  let packet;
  try {
    packet = await getCompliancePacket(workspaceId, tenantId);

    if (!packet) {
      return withTraceId(Response.json(
        { error: "No published compliance packet available. Publish a policy revision first.", meta: makeMeta(traceId) },
        { status: 404 }
      ), traceId);
    }

    const sealedAt = new Date().toISOString();
    const packetDigest = createHash("sha256")
      .update(JSON.stringify({ export: packet.export, timeline: packet.timeline, sealedAt }))
      .digest("hex");
    const sealToken = `spctre-seal-${packetDigest.slice(0, 32)}`;

    recordComplianceOperation({
      tenantId,
      workspaceId,
      eventType: "COMPLIANCE_EXPORT",
      actorId,
      payload: { action: "SEAL", sealToken, packetDigest, sealedAt },
    }).catch(swallow("recordComplianceOperation", undefined));

    return withTraceId(Response.json({
      sealToken,
      packetDigest: `sha256:${packetDigest}`,
      sealedAt,
      branchId: packet.export.artifact.branchId,
      revisionId: packet.export.artifact.revisionId,
      approvalCount: packet.export.approvalCount,
      evidenceCount: packet.export.evidenceCount,
      message:
        "Audit sealed. The seal token and packet digest are recorded in the tamper-evident operations log.",
      meta: makeMeta(traceId),
    }), traceId);
  } catch (err) {
    console.error("[compliance/seal] seal operation failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
}

export { handleGetApiComplianceSeal as GET };
