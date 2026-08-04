import {
  getCompliancePacket,
  getComplianceVerificationStatus,
} from "@/lib/domains/compliance/service";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { resolveRouteScope } from "../../_route-scope";

export const dynamic = "force-dynamic";

async function handleGetApiComplianceStatus(request: Request) {
  const traceId = extractTraceId(request);
  const scope = await resolveRouteScope(request, { serviceTokenScope: "compliance:read", traceId });
  if (scope instanceof Response) return scope;
  const { workspaceId, tenantId } = scope;

  let packet;
  try {
    packet = await getCompliancePacket(workspaceId, tenantId);
  } catch (err) {
    console.error("[compliance/status] getCompliancePacket failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  if (!packet) {
    return withTraceId(
      Response.json({
        workspaceId,
        available: false,
        message: "No published compliance packet available. Publish a policy revision first.",
        meta: makeMeta(traceId),
      }),
      traceId,
    );
  }

  let verification = null;
  if (packet.export.artifactHash) {
    verification = await getComplianceVerificationStatus({
      workspaceId,
      tenantId,
      artifactHash: packet.export.artifactHash,
    }).catch((err) => {
      console.error("[compliance/status] getLatestVerificationStatus failed", err);
      return null;
    });
  }

  return withTraceId(
    Response.json({
      workspaceId,
      available: true,
      revisionId: packet.export.artifact.revisionId,
      artifactHash: packet.export.artifactHash,
      summary: {
        evidenceCount: packet.export.evidenceCount,
        approvalCount: packet.export.approvalCount,
        deniedDecisionCount: packet.export.deniedDecisionCount,
        warnedDecisionCount: packet.export.warnedDecisionCount,
        escalationCount: packet.escalations.length,
      },
      verification: verification
        ? {
            overallOutcome: verification.overallOutcome,
            isStale: verification.isStale,
            staleThresholdDays: verification.staleThresholdDays,
            latestRunAt: verification.latestRunAt,
          }
        : null,
      generatedAt: new Date().toISOString(),
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handleGetApiComplianceStatus as GET };
