import { recordIdentityEvent, recordIdentityOperation } from "@/lib/domains/identity/service";

import { getAuthSession } from "@/lib/auth-session";
import { getActiveScope } from "@/lib/workspace";
import type { IdentityLifecycleEventType, IdentityEventSource } from "@spctre/policy-schema";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { asString } from "../../_shared";

export const dynamic = "force-dynamic";

const VALID_EVENT_TYPES = new Set<IdentityLifecycleEventType>([
  "CREATED", "UPDATED", "DELETED",
  "CREDENTIAL_ADDED", "CREDENTIAL_REMOVED",
  "MFA_ENROLLED", "MFA_REVOKED",
  "SSO_LINKED", "SSO_UNLINKED",
  "ROLE_GRANTED", "ROLE_REVOKED",
  "SESSION_REVOKED", "TOKEN_ISSUED", "TOKEN_REVOKED",
  "SURFACE_LINKED", "SURFACE_UNLINKED",
]);

const VALID_SOURCES = new Set<IdentityEventSource>([
  "OIDC", "SAML", "LOCAL", "API", "ADMIN", "SYSTEM",
]);

async function handlePostApiIdentityEvent(request: Request) {
  const traceId = extractTraceId(request);
  const session = await getAuthSession().catch(() => null);
  if (!session) return withTraceId(Response.json({ error: "Authentication required.", meta: makeMeta(traceId) }, { status: 401 }), traceId);

  const ctx = await getActiveScope().catch(() => null);
  if (!ctx) return withTraceId(Response.json({ error: "Workspace context unavailable.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return withTraceId(Response.json({ error: "Request body must be an object.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const rec = body as Record<string, unknown>;
  const principalId = asString(rec.principalId);
  const eventType = asString(rec.eventType) as IdentityLifecycleEventType | undefined;
  const source = asString(rec.source) as IdentityEventSource | undefined;
  const detail = rec.detail && typeof rec.detail === "object" && !Array.isArray(rec.detail)
    ? rec.detail as Record<string, unknown>
    : {};
  const agentDid = asString(rec.agentDid);
  const signatureAlgorithm = asString(rec.signatureAlgorithm);
  const signatureKeyId = asString(rec.signatureKeyId);
  const payloadHash = asString(rec.payloadHash);
  const signature = asString(rec.signature);
  const signatureVerificationOutcome = asString(rec.signatureVerificationOutcome) as "PASS" | "FAIL" | "WARN" | undefined;
  const signatureFailureReason = asString(rec.signatureFailureReason);
  const signatureVerifiedAt = asString(rec.signatureVerifiedAt);

  if (!principalId) return withTraceId(Response.json({ error: "principalId is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  if (!eventType || !VALID_EVENT_TYPES.has(eventType)) {
    return withTraceId(Response.json({ error: "eventType must be a valid IdentityLifecycleEventType.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (!source || !VALID_SOURCES.has(source)) {
    return withTraceId(Response.json({ error: "source must be a valid IdentityEventSource.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (signatureVerificationOutcome && !["PASS", "WARN", "FAIL"].includes(signatureVerificationOutcome)) {
    return withTraceId(Response.json({ error: "signatureVerificationOutcome must be PASS, FAIL, or WARN.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
  if (signatureVerifiedAt && Number.isNaN(Date.parse(signatureVerifiedAt))) {
    return withTraceId(Response.json({ error: "signatureVerifiedAt must be a valid date-time string when provided.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  try {
    await recordIdentityEvent({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      principalId,
      eventType,
      actorId: session.principalId,
      source,
      detail,
      agentDid,
      signatureAlgorithm,
      signatureKeyId,
      payloadHash,
      signature,
      signatureVerificationOutcome,
      signatureFailureReason,
      signatureVerifiedAt,
    });
  } catch (err) {
    console.error("[identity/event] recordIdentityLifecycleEvent failed", err);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }

  recordIdentityOperation({
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    eventType: "IDENTITY_CHANGE",
    sourceId: principalId,
    sourceTable: "agt_identity_lifecycle_event",
    actorId: session.principalId,
    payload: { principalId, eventType, source },
  }).catch(() => {});

  return withTraceId(Response.json({ ok: true, meta: makeMeta(traceId) }, { status: 201 }), traceId);
}

export { handlePostApiIdentityEvent as POST };
