import {
  ingestVerification,
  listVerificationRuns,
  recordVerificationOperation,
} from "@/lib/domains/verification/service";

import type { AgtVerificationType, AgtVerificationOutcome } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { incrementCounter, recordDuration } from "@spctre/platform/metrics";
import { withSpan } from "@spctre/platform/tracing";
import { asString } from "../_shared";
import { resolveRouteScope } from "../_route-scope";
import { swallow } from "@/lib/platform/swallow";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<AgtVerificationType>([
  "AGT_VERIFY",
  "AGT_VERIFY_EVIDENCE",
  "AGT_LINT_POLICY",
  "AGT_REDTEAM",
  "AGT_REPLAY",
  "CUSTOM",
]);

const VALID_OUTCOMES = new Set<AgtVerificationOutcome>(["PASS", "FAIL", "WARN"]);

function isValidDateTime(value: string | undefined): boolean {
  return value === undefined || !Number.isNaN(Date.parse(value));
}

// Validate the required and format-constrained ingest fields. Returns the
// error message for the 400 response, or null when valid.
function validateVerificationFields(fields: {
  artifactHash?: string;
  verificationType?: AgtVerificationType;
  outcome?: AgtVerificationOutcome;
  issuedAt?: string;
  completedAt?: string;
  compatibilityCheckedAt?: string;
  escrowVerifiedAt?: string;
  compatibilityCheckOutcome?: "PASS" | "FAIL" | "WARN";
  escrowVerificationOutcome?: "PASS" | "FAIL" | "WARN";
  verifierLockDigest?: string;
  policyContentHash?: string;
}): string | null {
  if (!fields.artifactHash) {
    return "artifactHash is required.";
  }
  if (!fields.verificationType || !VALID_TYPES.has(fields.verificationType)) {
    return "verificationType must be a valid AgtVerificationType.";
  }
  if (!fields.outcome || !VALID_OUTCOMES.has(fields.outcome)) {
    return "outcome must be PASS, FAIL, or WARN.";
  }
  if (
    !isValidDateTime(fields.issuedAt) ||
    !isValidDateTime(fields.completedAt) ||
    !isValidDateTime(fields.compatibilityCheckedAt) ||
    !isValidDateTime(fields.escrowVerifiedAt)
  ) {
    return "date-time fields must be valid date-time strings when provided.";
  }
  if (fields.compatibilityCheckOutcome && !VALID_OUTCOMES.has(fields.compatibilityCheckOutcome)) {
    return "compatibilityCheckOutcome must be PASS, FAIL, or WARN.";
  }
  if (fields.escrowVerificationOutcome && !VALID_OUTCOMES.has(fields.escrowVerificationOutcome)) {
    return "escrowVerificationOutcome must be PASS, FAIL, or WARN.";
  }
  if (
    (fields.verifierLockDigest && !/^sha256:[0-9a-f]{64}$/.test(fields.verifierLockDigest)) ||
    (fields.policyContentHash && !/^sha256:[0-9a-f]{64}$/.test(fields.policyContentHash))
  ) {
    return "verifierLockDigest and policyContentHash must be lowercase SHA-256 digests.";
  }
  return null;
}

async function handlePostApiVerification(request: Request) {
  const traceId = extractTraceId(request);
  const started = Date.now();
  return await withSpan(
    "api.verification.ingest",
    { "spctre.request_id": traceId, "http.route": "/api/verification" },
    async (span) => {
      // This endpoint historically returned 401 for every auth failure, including
      // "Workspace context unavailable." Preserve that contract (status + metric).
      const auth = await resolveRouteScope(request, {
        serviceTokenScope: "evidence:write",
        traceId,
        contextUnavailableStatus: 401,
      });
      if (auth instanceof Response) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/verification",
          "http.response.status_code": auth.status,
        });
        return auth;
      }

      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/verification",
          "http.response.status_code": 400,
        });
        return withTraceId(
          Response.json(
            { error: "Request body must be an object.", meta: makeMeta(traceId) },
            { status: 400 },
          ),
          traceId,
        );
      }

      const rec = body as Record<string, unknown>;
      const artifactHash = asString(rec.artifactHash);
      const verificationType = asString(rec.verificationType) as AgtVerificationType | undefined;
      const outcome = asString(rec.outcome) as AgtVerificationOutcome | undefined;
      const revisionId = asString(rec.revisionId);
      const runtimeVersion = asString(rec.runtimeVersion);
      const verifierLockDigest = asString(rec.verifierLockDigest);
      const policyContentHash = asString(rec.policyContentHash);
      const summary =
        rec.summary && typeof rec.summary === "object" && !Array.isArray(rec.summary)
          ? (rec.summary as Record<string, unknown>)
          : {};
      // AGT v4.0.0 additive tamper-evidence fields (spec §4.3.1 — all optional)
      const argumentsHash = asString(rec.argumentsHash);
      const approverDid = asString(rec.approverDid);
      const policyVersion = asString(rec.policyVersion);
      const issuedAt = asString(rec.issuedAt);
      const completedAt = asString(rec.completedAt);
      const agtVersion = asString(rec.agtVersion);
      const agtPoliciesVersion = asString(rec.agtPoliciesVersion);
      const cedarPolicyVersion = asString(rec.cedarPolicyVersion);
      const policyEngineVersion = asString(rec.policyEngineVersion);
      const compatibilityCheckedAt = asString(rec.compatibilityCheckedAt);
      const compatibilityCheckOutcome = asString(rec.compatibilityCheckOutcome) as
        "PASS" | "FAIL" | "WARN" | undefined;
      const escrowSignerId = asString(rec.escrowSignerId);
      const escrowKeyId = asString(rec.escrowKeyId);
      const outcomeHash = asString(rec.outcomeHash);
      const escrowSignature = asString(rec.escrowSignature);
      const escrowVerificationOutcome = asString(rec.escrowVerificationOutcome) as
        "PASS" | "FAIL" | "WARN" | undefined;
      const escrowVerifiedAt = asString(rec.escrowVerifiedAt);

      const validationError = validateVerificationFields({
        artifactHash,
        verificationType,
        outcome,
        issuedAt,
        completedAt,
        compatibilityCheckedAt,
        escrowVerifiedAt,
        compatibilityCheckOutcome,
        escrowVerificationOutcome,
        verifierLockDigest,
        policyContentHash,
      });
      if (validationError) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/verification",
          "http.response.status_code": 400,
        });
        return withTraceId(
          Response.json({ error: validationError, meta: makeMeta(traceId) }, { status: 400 }),
          traceId,
        );
      }

      const id = await ingestVerification({
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        revisionId,
        artifactHash: artifactHash!,
        verificationType: verificationType!,
        outcome: outcome!,
        summary,
        runBy: auth.actorId,
        runtimeVersion,
        verifierLockDigest,
        policyContentHash,
        argumentsHash,
        approverDid,
        policyVersion,
        issuedAt,
        completedAt,
        agtVersion,
        agtPoliciesVersion,
        cedarPolicyVersion,
        policyEngineVersion,
        compatibilityCheckedAt,
        compatibilityCheckOutcome,
        escrowSignerId,
        escrowKeyId,
        outcomeHash,
        escrowSignature,
        escrowVerificationOutcome,
        escrowVerifiedAt,
      });
      if (!id) {
        incrementCounter("spctre.api.errors", 1, {
          "http.route": "/api/verification",
          "http.response.status_code": 500,
        });
        return withTraceId(
          Response.json(
            { error: "Unable to persist verification result.", meta: makeMeta(traceId) },
            { status: 500 },
          ),
          traceId,
        );
      }

      recordVerificationOperation({
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        eventType: "VERIFICATION_RUN",
        sourceId: id,
        sourceTable: "agt_verification_result",
        actorId: auth.actorId,
        payload: { artifactHash, policyContentHash, verifierLockDigest, verificationType, outcome, revisionId },
      }).catch(swallow("recordVerificationOperation", undefined));

      span.setAttributes({
        "spctre.verification.type": verificationType,
        "spctre.verification.outcome": outcome,
      });
      incrementCounter("spctre.verification.ingest", 1, { verificationType, outcome });
      recordDuration("spctre.verification.ingest.duration", Date.now() - started, {
        verificationType,
        outcome,
      });
      return withTraceId(
        Response.json({ ok: true, id, outcome, meta: makeMeta(traceId) }, { status: 201 }),
        traceId,
      );
    },
  );
}

async function handleGetApiVerification(request: Request) {
  const traceId = extractTraceId(request);
  return await withSpan(
    "api.verification.list",
    { "spctre.request_id": traceId, "http.route": "/api/verification" },
    async () => {
      const ctx = await resolveRouteScope(request, {
        serviceTokenScope: "compliance:read",
        traceId,
      });
      if (ctx instanceof Response) return ctx;

      const url = new URL(request.url);
      const revisionId = url.searchParams.get("revisionId")?.trim() || undefined;
      const artifactHash = url.searchParams.get("artifactHash")?.trim() || undefined;
      const limit = Math.max(
        1,
        Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
      );

      const results = await listVerificationRuns({
        workspaceId: ctx.workspaceId,
        tenantId: ctx.tenantId,
        revisionId,
        artifactHash,
        limit,
      });

      return withTraceId(
        Response.json({
          results,
          count: results.length,
          generatedAt: new Date().toISOString(),
          pagination: { total: results.length, limit, offset: 0 },
          meta: makeMeta(traceId),
        }),
        traceId,
      );
    },
  );
}

export { handleGetApiVerification as GET };
export { handlePostApiVerification as POST };
