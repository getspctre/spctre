import { getAuthSession } from "@/lib/auth-session";
import {
  getAgtVerificationExportInputs,
  getGatewayOutcomeMapForEvidence,
  listEvidenceForExport,
  listEvidenceForTokenExport,
} from "@/lib/domains/evidence/service";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { buildAgtVerificationEvidencePacket } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

async function handleGetApiEvidenceExport(request: Request) {
  const traceId = extractTraceId(request);
  const started = Date.now();
  return await withSpan(
    "api.evidence.export",
    { "spctre.request_id": traceId, "http.route": "/api/evidence/export" },
    async (span) => {
      const url = new URL(request.url);
      const requestedFormat = url.searchParams.get("format");
      const format =
        requestedFormat === "json" || requestedFormat === "agt-verification"
          ? requestedFormat
          : "csv";
      span.setAttribute("spctre.export.format", format);

      const bearer = hasBearerToken(request);
      const tokenAuth = bearer
        ? await authenticateServiceToken(request, "evidence:export")
        : null;
      const evidenceToken = tokenAuth?.ok ? tokenAuth.auth : null;
      if (bearer && (!evidenceToken?.connector || !evidenceToken.evidenceExportGrants.length)) {
        return withTraceId(
          Response.json({ error: "Invalid or insufficient evidence export token.", meta: makeMeta(traceId) }, { status: 401 }),
          traceId,
        );
      }
      if (bearer && requestedFormat === "agt-verification") {
        return withTraceId(
          Response.json({ error: "AGT verification packets require a live harness attestation.", meta: makeMeta(traceId) }, { status: 403 }),
          traceId,
        );
      }
      if (bearer && url.searchParams.has("connector") && url.searchParams.get("connector") !== evidenceToken!.connector) {
        return withTraceId(
          Response.json({ error: "Connector does not match token identity.", meta: makeMeta(traceId) }, { status: 403 }),
          traceId,
        );
      }

      let workspaceContext: { workspaceId: string; tenantId: string };
      if (bearer) {
        workspaceContext = { workspaceId: evidenceToken!.workspaceId, tenantId: evidenceToken!.tenantId };
      } else {
        const session = await getAuthSession().catch(swallow("getAuthSession", null));
        if (!session) {
          return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);
        }
        try {
          workspaceContext = await getActiveScope();
        } catch (err) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/evidence/export",
          "http.response.status_code": 503,
        });
        console.error("[evidence/export] getActiveScope failed", err);
        return withTraceId(
          Response.json(
            { error: "Workspace context unavailable.", meta: makeMeta(traceId) },
            { status: 503 },
          ),
          traceId,
        );
        }
      }

      if (!workspaceContext.workspaceId || !workspaceContext.tenantId) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/evidence/export",
          "http.response.status_code": 400,
        });
        return withTraceId(
          Response.json(
            { error: "Workspace context unavailable.", meta: makeMeta(traceId) },
            { status: 400 },
          ),
          traceId,
        );
      }

      let evidence;
      try {
        evidence = bearer
          ? await listEvidenceForTokenExport({
              workspaceId: workspaceContext.workspaceId,
              tenantId: workspaceContext.tenantId,
              connector: evidenceToken!.connector!,
              grants: evidenceToken!.evidenceExportGrants,
            })
          : await listEvidenceForExport({
              workspaceId: workspaceContext.workspaceId,
              tenantId: workspaceContext.tenantId,
              limit: 5000,
              offset: 0,
            });
      } catch (err) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/evidence/export",
          "http.response.status_code": 503,
        });
        console.error("[evidence/export] listRuntimeEvidence failed", err);
        return withTraceId(
          Response.json(
            { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
            { status: 503 },
          ),
          traceId,
        );
      }
      span.setAttribute("spctre.evidence.count", evidence.length);

      const date = new Date().toISOString().slice(0, 10);

      if (format === "agt-verification") {
        let exportInputs;
        try {
          exportInputs = await getAgtVerificationExportInputs({
            workspaceId: workspaceContext.workspaceId,
            tenantId: workspaceContext.tenantId,
          });
        } catch (err) {
          incrementCounter("spctre.api.errors", 1, {
            "http.route": "/api/evidence/export",
            "http.response.status_code": 503,
          });
          console.error("[evidence/export] getLatestPublishedBundle failed", err);
          return withTraceId(
            Response.json(
              { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
              { status: 503 },
            ),
            traceId,
          );
        }
        if (!exportInputs) {
          incrementCounter("spctre.api.errors", 1, {
            "http.route": "/api/evidence/export",
            "http.response.status_code": 404,
          });
          return withTraceId(
            Response.json(
              {
                error: "No published policy bundle is available for AGT verification export.",
                meta: makeMeta(traceId),
              },
              { status: 404 },
            ),
            traceId,
          );
        }

        const { published, escalations, verificationResults } = exportInputs;
        const scopedEvidence = evidence.filter(
          (record) =>
            record.artifactHash === published.artifactHash ||
            record.policyContext.some(
              (context) =>
                context.artifactHash === published.artifactHash ||
                context.revisionId === published.revisionId,
            ),
        );

        const packet = buildAgtVerificationEvidencePacket({
          bundle: published.bundle,
          evidence: scopedEvidence,
          generatedAt: new Date().toISOString(),
          escalations,
          verificationResults,
        });
        const body = JSON.stringify(packet, null, 2);
        recordDuration("spctre.evidence.export.duration", Date.now() - started, { format });
        return withTraceId(
          new Response(body, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "content-disposition": `attachment; filename="spctre-agt-evidence-${date}.json"`,
              "cache-control": "no-store",
              "x-spctre-artifact-hash": published.artifactHash,
              "x-spctre-revision-id": published.revisionId,
              "x-spctre-agt-verifier": "agt verify --evidence",
            },
          }),
          traceId,
        );
      }

      if (format === "json") {
        const body = JSON.stringify(
          {
            schemaVersion: "spctre/v1",
            exportedAt: new Date().toISOString(),
            workspaceId: workspaceContext.workspaceId,
            count: evidence.length,
            decisions: evidence,
          },
          null,
          2,
        );
        recordDuration("spctre.evidence.export.duration", Date.now() - started, { format });
        return withTraceId(
          new Response(body, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "content-disposition": `attachment; filename="spctre-evidence-${date}.json"`,
              "cache-control": "no-store",
            },
          }),
          traceId,
        );
      }

      const header =
        "decisionId,agentId,connector,action,status,reason,environment,runtimeStack,latencyMs,artifactHash,createdAt,gatewayOutcome\n";

      const gatewayOutcomeMap = await getGatewayOutcomeMapForEvidence({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
        decisionIds: evidence.map((e) => e.decisionId),
      });

      const rows = evidence
        .map((e) =>
          [
            csvCell(e.decisionId),
            csvCell(e.agentId),
            csvCell(e.connector),
            csvCell(e.action),
            csvCell(e.status),
            csvCell(e.reason),
            csvCell(e.environment),
            csvCell(e.runtimeTarget.stack),
            e.latencyMs,
            csvCell(e.artifactHash),
            csvCell(e.createdAt),
            csvCell(gatewayOutcomeMap.get(e.decisionId) ?? ""),
          ].join(","),
        )
        .join("\n");

      recordDuration("spctre.evidence.export.duration", Date.now() - started, { format });
      return withTraceId(
        new Response(header + rows, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="spctre-evidence-${date}.csv"`,
            "cache-control": "no-store",
          },
        }),
        traceId,
      );
    },
  );
}

function csvCell(value: string | number | null | undefined): string {
  const str = String(value ?? "");
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

export { handleGetApiEvidenceExport as GET };
