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
import { reportSwallowedError, swallow } from "@/lib/platform/swallow";
import {
  listPublicationAttestations,
  type PublicationAttestationCursor,
  type PublicationAttestationRecord,
  type PublicationExportGrant,
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
      let firstPublicationPage: PublicationAttestationRecord[] = [];
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
        if (format === "json") {
          firstPublicationPage = await runWithTenantContext(workspaceContext.tenantId, () =>
            listPublicationAttestations({
              tenantId: workspaceContext.tenantId,
              workspaceId: workspaceContext.workspaceId,
              ...(bearer ? { exportGrants: evidenceToken!.evidenceExportGrants } : {}),
              limit: 500,
            }),
          );
        }
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
        const publicationPages = publicationExportPages(
          {
            tenantId: workspaceContext.tenantId,
            workspaceId: workspaceContext.workspaceId,
            ...(bearer ? { grants: evidenceToken!.evidenceExportGrants } : {}),
          },
          firstPublicationPage,
        );
        const body = streamJsonEvidenceExport({
          evidence,
          workspaceId: workspaceContext.workspaceId,
          publicationPages,
          authorization: evidenceToken
            ? {
                connector: evidenceToken.connector!,
                revisionGrants: evidenceToken.evidenceExportGrants.map((grant) => ({
                  revisionId: grant.revisionId,
                  notBefore: grant.notBefore,
                  ...(grant.notAfter ? { notAfter: grant.notAfter } : {}),
                })),
              }
            : undefined,
          onComplete: () =>
            recordDuration("spctre.evidence.export.duration", Date.now() - started, { format }),
        });
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

async function* publicationExportPages(
  params: { tenantId: string; workspaceId: string; grants?: PublicationExportGrant[] },
  initialPage: PublicationAttestationRecord[],
): AsyncGenerator<PublicationAttestationRecord[]> {
  let page = initialPage;
  let before: PublicationAttestationCursor | undefined;
  for (;;) {
    yield page;
    if (page.length < 500) return;
    const last = page.at(-1)!;
    before = { attestedAt: last.attestedAt, id: last.id };
    page = await runWithTenantContext(params.tenantId, () =>
      listPublicationAttestations({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        exportGrants: params.grants,
        before,
        limit: 500,
      }),
    );
  }
}

function streamJsonEvidenceExport(params: {
  evidence: unknown[];
  workspaceId: string;
  publicationPages: AsyncGenerator<PublicationAttestationRecord[]>;
  authorization?: { connector: string; revisionGrants: unknown[] };
  onComplete: () => void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = params.publicationPages[Symbol.asyncIterator]();
  let emittedPrefix = false;
  let firstAttestation = true;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (!emittedPrefix) {
          const prefix = [
            `"schemaVersion":${JSON.stringify("spctre/v1")}`,
            `"exportedAt":${JSON.stringify(new Date().toISOString())}`,
            `"workspaceId":${JSON.stringify(params.workspaceId)}`,
            `"count":${params.evidence.length}`,
            `"decisions":${JSON.stringify(params.evidence)}`,
            '"publicationAttestations":[',
          ].join(",");
          controller.enqueue(encoder.encode(`{${prefix}`));
          emittedPrefix = true;
          return;
        }
        const next = await iterator.next();
        if (!next.done) {
          const records = next.value.map((attestation) => JSON.stringify(attestation)).join(",");
          controller.enqueue(encoder.encode(`${firstAttestation ? "" : ","}${records}`));
          firstAttestation = firstAttestation && next.value.length === 0;
          return;
        }
        controller.enqueue(
          encoder.encode(
            `]${params.authorization ? `,"authorization":${JSON.stringify(params.authorization)}` : ""},"complete":true}`,
          ),
        );
        params.onComplete();
        controller.close();
      } catch (error) {
        reportSwallowedError("evidenceExport.stream", error);
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

function csvCell(value: string | number | null | undefined): string {
  const str = String(value ?? "");
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

export { handleGetApiEvidenceExport as GET };
