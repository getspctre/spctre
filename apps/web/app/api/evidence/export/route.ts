import { getAuthSession } from "@/lib/auth-session";
import {
  getGatewayOutcomeMapForEvidence,
  listEvidenceForExport,
  listEvidenceForTokenExport,
} from "@/lib/domains/evidence/service";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { getActiveScope } from "@/lib/workspace";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { swallow } from "@/lib/platform/swallow";
import {
  filterPublicationAttestationsForExport,
  listPublicationAttestations,
} from "@/lib/repositories/publication-attestations";
import { runWithTenantContext } from "@/lib/tenant-context";

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
      if (requestedFormat === "agt-verification") {
        return withTraceId(
          Response.json(
            {
              error:
                "AGT verification packets are emitted only by the live compatibility harness, not by evidence export.",
              meta: makeMeta(traceId),
            },
            { status: 403 },
          ),
          traceId,
        );
      }
      const format = requestedFormat === "json" ? "json" : "csv";
      span.setAttribute("spctre.export.format", format);

      const bearer = hasBearerToken(request);
      const tokenAuth = bearer ? await authenticateServiceToken(request, "evidence:export") : null;
      const evidenceToken = tokenAuth?.ok ? tokenAuth.auth : null;
      if (bearer && (!evidenceToken?.connector || !evidenceToken.evidenceExportGrants.length)) {
        return withTraceId(
          Response.json(
            { error: "Invalid or insufficient evidence export token.", meta: makeMeta(traceId) },
            { status: 401 },
          ),
          traceId,
        );
      }
      if (
        bearer &&
        url.searchParams.has("connector") &&
        url.searchParams.get("connector") !== evidenceToken!.connector
      ) {
        return withTraceId(
          Response.json(
            { error: "Connector does not match token identity.", meta: makeMeta(traceId) },
            { status: 403 },
          ),
          traceId,
        );
      }

      let workspaceContext: { workspaceId: string; tenantId: string };
      if (bearer) {
        workspaceContext = {
          workspaceId: evidenceToken!.workspaceId,
          tenantId: evidenceToken!.tenantId,
        };
      } else {
        const session = await getAuthSession().catch(swallow("getAuthSession", null));
        if (!session) {
          return withTraceId(
            Response.json(
              { error: "Authentication required.", meta: makeMeta(traceId) },
              { status: 401 },
            ),
            traceId,
          );
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
      let publicationAttestations;
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
        const workspacePublicationAttestations = await runWithTenantContext(workspaceContext.tenantId, () =>
          listPublicationAttestations({
            workspaceId: workspaceContext.workspaceId,
            tenantId: workspaceContext.tenantId,
            limit: 500,
          }),
        );
        publicationAttestations = bearer
          ? filterPublicationAttestationsForExport(
              workspacePublicationAttestations,
              evidenceToken!.evidenceExportGrants,
            )
          : workspacePublicationAttestations;
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

      if (format === "json") {
        const body = JSON.stringify(
          {
            schemaVersion: "spctre/v1",
            exportedAt: new Date().toISOString(),
            workspaceId: workspaceContext.workspaceId,
            count: evidence.length,
            decisions: evidence,
            publicationAttestations,
            // This is a server-derived statement of the caller's authorization,
            // not a caller-selected connector filter. Agent runtimes can use it
            // to cross-check their loaded policy references without claiming a
            // live AGT deployment.
            ...(evidenceToken
              ? {
                  authorization: {
                    connector: evidenceToken.connector,
                    revisionGrants: evidenceToken.evidenceExportGrants.map((grant) => ({
                      revisionId: grant.revisionId,
                      notBefore: grant.notBefore,
                      ...(grant.notAfter ? { notAfter: grant.notAfter } : {}),
                    })),
                  },
                }
              : {}),
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
