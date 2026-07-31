import {
  getComplianceOperationsEventCounts,
  getCompliancePacket,
  getComplianceVerificationStatus,
  getEvidenceRetentionPlan,
  recordComplianceExportConversion,
} from "@/lib/domains/compliance/service";

import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { handleCompliancePdfExport } from "@/lib/ee-adapters/compliance-pdf";
import { buildComplianceFrameworkAnnotation, buildGrcEvidenceBridgeExport } from "@spctre/policy-schema";
import type { ComplianceFramework } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const SUPPORTED_FRAMEWORKS = new Set<ComplianceFramework>([
  "soc2",
  "iso27001",
  "hipaa",
  "gdpr",
  "pci-dss",
  "nist-ai-rmf",
  "public-sector",
  "eu-ai-act",
]);

function parseFramework(raw: string | null): ComplianceFramework | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase() as ComplianceFramework;
  return SUPPORTED_FRAMEWORKS.has(lower) ? lower : undefined;
}

type CompliancePacket = NonNullable<Awaited<ReturnType<typeof getCompliancePacket>>>;
type RetentionPlan = Awaited<ReturnType<typeof getEvidenceRetentionPlan>>;
type VerificationSummary = Awaited<ReturnType<typeof getComplianceVerificationStatus>> | null;

function buildExportDoc(params: {
  packet: CompliancePacket;
  retentionPlan: RetentionPlan;
  verificationSummary: VerificationSummary;
  frameworkAnnotation: ReturnType<typeof buildComplianceFrameworkAnnotation> | undefined;
  generatedAt: string;
}) {
  const { packet, retentionPlan, verificationSummary, frameworkAnnotation, generatedAt } = params;
  return {
    schemaVersion: "spctre/v1",
    exportedAt: generatedAt,
    artifactHash: packet.export.artifactHash,
    evidenceCount: packet.export.evidenceCount,
    artifact: packet.export.artifact,
    approvals: packet.export.readiness.approvals,
    timeline: packet.timeline,
    summary: {
      evidenceCount: packet.export.evidenceCount,
      approvalCount: packet.export.approvalCount,
      policyRefCount: packet.export.policyRefCount,
      deniedDecisionCount: packet.export.deniedDecisionCount,
      warnedDecisionCount: packet.export.warnedDecisionCount,
      simulationEventCount: packet.export.simulationEventCount,
      packageSections: packet.export.packageSections,
      resolvedEscalationCount: packet.escalations.length,
    },
    escalations: packet.escalations.map((esc) => ({
      id: esc.id,
      decisionId: esc.decisionId,
      revisionId: esc.revisionId,
      artifactHash: esc.artifactHash,
      resolutionOutcome: esc.resolutionOutcome,
      resolutionNote: esc.resolutionNote,
      resolvedAt: esc.resolvedAt,
      slaDueAt: esc.slaDueAt,
      slaMet: esc.slaMet,
    })),
    verificationResults: verificationSummary
      ? {
          hasResults: verificationSummary.hasResults,
          overallOutcome: verificationSummary.overallOutcome,
          isStale: verificationSummary.isStale,
          staleThresholdDays: verificationSummary.staleThresholdDays,
          latestRunAt: verificationSummary.latestRunAt,
          resultsByType: verificationSummary.resultsByType,
        }
      : null,
    forensicLedger: packet.forensicLedger ?? null,
    frameworkAnnotation: frameworkAnnotation ?? null,
    retentionPlan: retentionPlan
      ? {
          id: retentionPlan.id,
          generatedAt: retentionPlan.generatedAt,
          activeCount: retentionPlan.activeCount,
          expiringCount: retentionPlan.expiringCount,
          expiredCount: retentionPlan.expiredCount,
          exportableCount: retentionPlan.exportableCount,
          decisions: retentionPlan.decisions.filter((d) => d.exportable),
        }
      : null,
  };
}

async function handleGetApiComplianceExport(request: Request) {
  const traceId = extractTraceId(request);
  const started = Date.now();
  return await withSpan("api.compliance.export", { "spctre.request_id": traceId, "http.route": "/api/compliance/export" }, async (span) => {
  const url = new URL(request.url);
  const framework = parseFramework(url.searchParams.get("framework"));
  span.setAttribute("spctre.compliance.framework", framework ?? "none");
  let tenantId: string;
  let workspaceId: string;

  const hasBearer = (request.headers.get("authorization") ?? "").startsWith("Bearer ");
  if (hasBearer) {
    const auth = await authenticateServiceToken(request, "compliance:read");
    if (!auth.ok) {
      incrementCounter("spctre.api.errors", 1, { "http.route": "/api/compliance/export", "http.response.status_code": 401 });
      return withTraceId(Response.json({ error: "Invalid or expired service token.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    tenantId = auth.auth.tenantId;
    workspaceId = auth.auth.workspaceId;
  } else {
    const session = await getAuthSession().catch(swallow("getAuthSession", null));
    if (!session) {
      incrementCounter("spctre.api.errors", 1, { "http.route": "/api/compliance/export", "http.response.status_code": 401 });
      return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
    }
    const workspaceContext = await getActiveScope();
    tenantId = workspaceContext.tenantId;
    workspaceId = workspaceContext.workspaceId;
  }

  if (!workspaceId || !tenantId) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/compliance/export", "http.response.status_code": 400 });
    return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  let packet;
  let retentionPlan;
  let operationsEventCounts: Record<string, number> = {};
  let verificationSummary = null;

  try {
    [packet, retentionPlan, operationsEventCounts] = await Promise.all([
      getCompliancePacket(workspaceId, tenantId),
      getEvidenceRetentionPlan(workspaceId, tenantId),
      getComplianceOperationsEventCounts({ tenantId, workspaceId }),
    ]);
    if (packet?.export.artifactHash) {
      verificationSummary = await getComplianceVerificationStatus({
        workspaceId,
        tenantId,
        artifactHash: packet.export.artifactHash,
      }).catch(swallow("getComplianceVerificationStatus", null));
    }
  } catch (err) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/compliance/export", "http.response.status_code": 503 });
    console.error("[compliance/export] repository fetch failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  if (!packet) {
    incrementCounter("spctre.api.errors", 1, { "http.route": "/api/compliance/export", "http.response.status_code": 404 });
    return withTraceId(Response.json(
      { error: "No published compliance packet available. Publish a policy revision first.", meta: makeMeta(traceId) },
      { status: 404 }
    ), traceId);
  }

  const generatedAt = new Date().toISOString();
  const frameworkAnnotation = framework
    ? buildComplianceFrameworkAnnotation({
        framework,
        approvalCount: packet.export.approvalCount,
        evidenceCount: packet.export.evidenceCount,
        deniedDecisionCount: packet.export.deniedDecisionCount,
        warnedDecisionCount: packet.export.warnedDecisionCount,
        escalationCount: packet.escalations.length,
        resolvedEscalationCount: packet.escalations.filter((e) => e.resolutionOutcome !== "ESCALATE").length,
        artifactHash: packet.export.artifactHash,
        operationsEventCounts,
        generatedAt,
      })
    : undefined;

  const exportDoc = buildExportDoc({ packet, retentionPlan, verificationSummary, frameworkAnnotation, generatedAt });

  if (url.searchParams.get("format")?.toLowerCase() === "grc") {
    return withTraceId(Response.json(buildGrcEvidenceBridgeExport(packet.export), {
      headers: {
        "cache-control": "no-store",
        "x-spctre-artifact-hash": packet.export.artifactHash,
        "x-spctre-revision-id": packet.export.artifact.revisionId,
      },
    }), traceId);
  }

  const body = JSON.stringify(exportDoc, null, 2);
  const revisionSlug = packet.export.artifact.revisionId.slice(0, 8);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `spctre-compliance-${revisionSlug}-${date}.json`;

  // Trigger FIRST_COMPLIANCE_EXPORT conversion telemetry asynchronously
  recordComplianceExportConversion(tenantId).catch(swallow("recordComplianceExportConversion", undefined));

  recordDuration("spctre.compliance.export.duration", Date.now() - started, { framework: framework ?? "none" });
  if (url.searchParams.get("format")?.toLowerCase() === "pdf") {
    return withTraceId(await handleCompliancePdfExport(request, exportDoc), traceId);
  }
  return withTraceId(new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-spctre-artifact-hash": packet.export.artifactHash,
      "x-spctre-revision-id": packet.export.artifact.revisionId,
    },
  }), traceId);
  });
}

export { handleGetApiComplianceExport as GET };
