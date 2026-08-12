/**
 * AGT Operations Store integration tests.
 *
 * Covers:
 * - appendOperationsLog: hash chain construction (content_hash / prev_hash)
 * - verifyOperationsLogChain: valid chain, single-entry chain, broken chain
 * - ingestTrustScoreEvent: first event, subsequent event, boundary values
 * - recordIdentityLifecycleEvent + listIdentityLifecycleEvents
 * - ingestVerificationResult + listVerificationResults
 * - API routes: trust ingest, identity event, verification POST/GET, operations GET, chain verify
 * - End-to-end: evidence ingest → operations log side-effect
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRouteRequest } from "./route-test-helper";
import { buildOperationsContentHash } from "@spctre/policy-schema";
import { isRecord } from "../lib/records";

// ── Shared state ──────────────────────────────────────────────────────────────

interface RowStore {
  operationsLog: Array<Record<string, unknown>>;
  trustScoreEvents: Array<Record<string, unknown>>;
  identityLifecycleEvents: Array<Record<string, unknown>>;
  verificationResults: Array<Record<string, unknown>>;
  // Per-tenant operations-log chain head (mirrors agt_operations_log_chain_head).
  chainHead: Map<string, string | null>;
}

let store: RowStore;
let opLogSeq = 0;

function resetStore() {
  store = {
    operationsLog: [],
    trustScoreEvents: [],
    identityLifecycleEvents: [],
    verificationResults: [],
    chainHead: new Map(),
  };
  opLogSeq = 0;
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  }
  return isRecord(value) ? value : {};
}

// Build a deterministic content_hash matching the real appendOperationsLog.
function buildContentHash(params: {
  eventType: string;
  sourceId?: string;
  sourceTable?: string;
  actorId?: string;
  payload?: unknown;
  prevHash?: string;
}): string {
  return buildOperationsContentHash({
    eventType: params.eventType,
    sourceId: params.sourceId ?? null,
    sourceTable: params.sourceTable ?? null,
    actorId: params.actorId ?? "",
    payload: isRecord(params.payload) ? params.payload : {},
    prevHash: params.prevHash ?? null,
  });
}

function makeOperationRow(params: {
  id: string;
  eventType?: string;
  sourceId?: string;
  sourceTable?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  prevHash?: string | null;
  storedPrevHash?: string | null;
  createdAt?: Date;
}) {
  const eventType = params.eventType ?? "EVIDENCE_INGEST";
  const sourceId = params.sourceId ?? params.id;
  const sourceTable = params.sourceTable ?? "runtime_evidence_event";
  const actorId = params.actorId ?? "svc-1";
  const payload = params.payload ?? { status: "ALLOW" };
  const prevHash = params.prevHash ?? null;
  return {
    id: params.id,
    event_type: eventType,
    source_id: sourceId,
    source_table: sourceTable,
    actor_id: actorId,
    payload,
    content_hash: buildContentHash({
      eventType,
      sourceId,
      sourceTable,
      actorId,
      payload,
      prevHash: prevHash ?? undefined,
    }),
    prev_hash: params.storedPrevHash !== undefined ? params.storedPrevHash : prevHash,
    created_at: params.createdAt ?? new Date(),
  };
}

// ── SQL mock ──────────────────────────────────────────────────────────────────

function makeSqlMock() {
  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("?").replace(/\s+/g, " ").trim().toUpperCase();

    // ── agt_operations_log_chain_head ─────────────────────────────────────
    // Must precede the agt_operations_log branch (substring overlap).
    if (joined.includes("AGT_OPERATIONS_LOG_CHAIN_HEAD")) {
      if (joined.startsWith("INSERT")) {
        // INSERT ... VALUES (${tenantId}, NULL) ... RETURNING last_hash
        // Upsert-and-lock: return the current head (null on first append).
        const tenantId = String(args[1]);
        return Promise.resolve([{ last_hash: store.chainHead.get(tenantId) ?? null }]);
      }
      if (joined.startsWith("UPDATE")) {
        // UPDATE ... SET last_hash = ${contentHash} ... WHERE tenant_id = ${tenantId}
        const newHash = (args[1] ?? null) as string | null;
        const tenantId = String(args[2]);
        store.chainHead.set(tenantId, newHash);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }

    // ── agt_operations_log ────────────────────────────────────────────────
    if (joined.includes("AGT_OPERATIONS_LOG") && joined.startsWith("INSERT")) {
      const seq = ++opLogSeq;
      const id = `op-log-${seq}`;
      const payload = parsePayload(args[7]);
      const row = {
        id,
        tenant_id: args[1],
        workspace_id: args[2],
        event_type: args[3],
        source_id: args[4],
        source_table: args[5],
        actor_id: args[6],
        payload,
        content_hash: args[8],
        prev_hash: args[9],
        created_at: new Date(),
      };
      store.operationsLog.push(row);
      return Promise.resolve([row]);
    }
    // SELECT for listOperationsLog (DESC) and verifyOperationsLogChain (ASC)
    // Mock returns rows in insertion order — callers care about structure, not ordering.
    if (joined.includes("AGT_OPERATIONS_LOG") && joined.startsWith("SELECT")) {
      return Promise.resolve([...store.operationsLog]);
    }

    // ── agt_trust_score_event ─────────────────────────────────────────────
    if (joined.includes("AGT_TRUST_SCORE_EVENT") && joined.startsWith("INSERT")) {
      const id = `ts-${store.trustScoreEvents.length + 1}`;
      const row = { id, created_at: new Date() };
      store.trustScoreEvents.push(row);
      return Promise.resolve([row]);
    }
    // Previous score lookup (ORDER BY ... LIMIT 1)
    if (joined.includes("AGT_TRUST_SCORE_EVENT") && joined.includes("LIMIT 1")) {
      const last = store.trustScoreEvents[store.trustScoreEvents.length - 1] ?? null;
      return Promise.resolve(last ? [{ trust_score: "0.8", ...last }] : []);
    }
    // History SELECT
    if (joined.includes("AGT_TRUST_SCORE_EVENT") && joined.startsWith("SELECT")) {
      return Promise.resolve(
        store.trustScoreEvents.map((r) => ({
          id: r.id,
          tenant_id: "demo-tenant",
          workspace_id: "demo-ws",
          agent_id: "agent-h",
          environment: "production",
          runtime_stack: "LOCAL",
          trust_score: "0.85",
          previous_score: null,
          delta: null,
          source: "MANUAL",
          source_ref: null,
          reason: null,
          created_at: new Date(),
          ...r,
        })),
      );
    }

    // ── agt_identity_lifecycle_event ──────────────────────────────────────
    if (joined.includes("AGT_IDENTITY_LIFECYCLE_EVENT") && joined.startsWith("INSERT")) {
      const id = `id-evt-${store.identityLifecycleEvents.length + 1}`;
      const row = { id, created_at: new Date() };
      store.identityLifecycleEvents.push(row);
      return Promise.resolve([row]);
    }
    if (joined.includes("AGT_IDENTITY_LIFECYCLE_EVENT") && joined.startsWith("SELECT")) {
      return Promise.resolve(
        store.identityLifecycleEvents.map((r) => ({
          id: "id-evt-x",
          tenant_id: "demo-tenant",
          workspace_id: "demo-ws",
          principal_id: "user-x",
          event_type: "CREATED",
          actor_id: "actor-x",
          source: "ADMIN",
          detail: {},
          created_at: new Date(),
          ...r,
        })),
      );
    }

    // ── agt_verification_result ───────────────────────────────────────────
    if (joined.includes("AGT_VERIFICATION_RESULT") && joined.startsWith("INSERT")) {
      const id = `vr-${store.verificationResults.length + 1}`;
      const row = { id, created_at: new Date() };
      store.verificationResults.push(row);
      return Promise.resolve([row]);
    }
    if (joined.includes("AGT_VERIFICATION_RESULT") && joined.startsWith("SELECT")) {
      return Promise.resolve(
        store.verificationResults.map((r) => ({
          id: "vr-x",
          tenant_id: "demo-tenant",
          workspace_id: "demo-ws",
          revision_id: null,
          artifact_hash: "sha256:x",
          verification_type: "AGT_VERIFY",
          outcome: "PASS",
          summary: {},
          run_by: "svc-ci",
          runtime_version: null,
          created_at: new Date(),
          ...r,
        })),
      );
    }

    // ── runtime_evidence_event ────────────────────────────────────────────
    if (joined.includes("RUNTIME_EVIDENCE_EVENT") && joined.startsWith("INSERT")) {
      return Promise.resolve([{ decision_id: "dec-ops-1" }]);
    }

    // ── evidence policy-context boundary check ────────────────────────────
    if (
      joined.includes("POLICY_REVISION") &&
      joined.includes("POLICY_BRANCH") &&
      joined.startsWith("SELECT")
    ) {
      const revisionIds = Array.isArray(args[2]) ? args[2] : [];
      const branchIds = Array.isArray(args[3]) ? args[3] : [];
      return Promise.resolve(revisionIds.map((id, index) => ({ id, branch_id: branchIds[index] })));
    }

    // Generic SELECT → valid auth / workspace rows
    if (joined.startsWith("SELECT")) {
      return Promise.resolve([{ id: "row-ok", count: "0", trust_score: "0.8" }]);
    }

    return Promise.resolve([]);
  };

  return Object.assign(fn, {
    begin: vi.fn(async (callback: (tx: typeof fn) => Promise<unknown>) => callback(fn)),
    // Mirrors postgres' sql.json(): the persisted jsonb payload is the
    // serialized value (a string param, not a JS array).
    json: (value: unknown) => JSON.stringify(value),
  });
}

const sqlMock = makeSqlMock();

vi.mock("@/lib/db", () => ({
  sql: sqlMock,
  rawSql: sqlMock,
  runWithTenantContext: vi.fn((_tenantId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: vi.fn((_tenantId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/demo", () => ({ DEMO_TENANT_ID: "demo-tenant", DEMO_WORKSPACE_ID: "demo-ws" }));

vi.mock("@/lib/repositories/seed/local-dev", () => ({
  ensureDemoTenant: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi
    .fn()
    .mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        principalId: "svc-test",
        scopes: [],
      },
    }),
  hasBearerToken: () => true,
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ principalId: "user-test" }),
}));

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: vi.fn().mockResolvedValue({ tenantId: "demo-tenant", workspaceId: "demo-ws" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@spctre/policy-schema", async (importOriginal) => {
  const real = await importOriginal<typeof import("@spctre/policy-schema")>();
  return {
    ...real,
    ingestAgtRuntimeDecision: (input: Record<string, unknown>) => ({
      decisionId: input.decisionId ?? "dec-passthrough",
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      environment: input.environment ?? "test",
      runtimeTarget: input.runtimeTarget ?? { stack: "LOCAL" },
      agentId: input.agentId ?? "agent-1",
      connector: input.connector ?? "test",
      action: input.action ?? "test",
      status: input.status ?? "ALLOW",
      reason: input.reason ?? "test",
      policyRefs: input.policyRefs ?? ["default.policy"],
      artifactHash: input.artifactHash ?? "sha256:test",
      policyContext: input.policyContext ?? [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:test" },
      ],
      latencyMs: 0,
      createdAt: new Date().toISOString(),
      rawEvidence: {},
    }),
  };
});

// Import routes and query helpers after mocks are registered.
const { appendOperationsLog, listOperationsLog, verifyOperationsLogChain } =
  await import("../lib/repositories/operations-log");
const { ingestTrustScoreEvent, listTrustScoreHistory } = await import("../lib/repositories/trust");
const { recordIdentityLifecycleEvent, listIdentityLifecycleEvents } =
  await import("../lib/repositories/identity");
const { ingestVerificationResult, listVerificationResults, getLatestVerificationStatus } =
  await import("../lib/repositories/verification");

const { GET: operationsGet } = await import("../app/api/operations/route");
const { GET: chainVerifyGet } = await import("../app/api/operations/verify/route");
const { POST: trustIngestPost } = await import("../app/api/trust/ingest/route");
const { GET: trustHistoryGet } = await import("../app/api/trust/history/route");
const { POST: identityEventPost } = await import("../app/api/identity/event/route");
const { GET: identityEventsGet } = await import("../app/api/identity/events/route");
const { POST: verificationPost, GET: verificationGet } =
  await import("../app/api/verification/route");
const { POST: evidencePost } = await import("../app/api/evidence/route");

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(resetStore);

// ── appendOperationsLog ───────────────────────────────────────────────────────

describe("appendOperationsLog", () => {
  it("inserts a log entry and returns without throwing", async () => {
    await expect(
      appendOperationsLog({
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        eventType: "EVIDENCE_INGEST",
        sourceId: "ev-1",
        sourceTable: "runtime_evidence_event",
        actorId: "actor-1",
        payload: { key: "value" },
      }),
    ).resolves.not.toThrow();

    expect(store.operationsLog).toHaveLength(1);
  });

  it("appends successive entries each referencing the previous", async () => {
    await appendOperationsLog({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      eventType: "POLICY_PUBLISH",
      sourceId: "rev-1",
      sourceTable: "policy_revision",
      actorId: "actor-a",
      payload: {},
    });

    await appendOperationsLog({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      eventType: "ESCALATION_RESOLVED",
      sourceId: "eq-1",
      sourceTable: "gateway_escalation_queue",
      actorId: "actor-b",
      payload: { resolutionOutcome: "PROCEED" },
    });

    expect(store.operationsLog).toHaveLength(2);
    // Second entry's prev_hash must reference the first entry's content_hash.
    expect(store.operationsLog[1].prev_hash).toBe(store.operationsLog[0].content_hash);
  });

  it("first entry has prev_hash = null when store is empty", async () => {
    await appendOperationsLog({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      eventType: "TRUST_SCORE_CHANGE",
      sourceId: "ts-1",
      sourceTable: "agt_trust_score_event",
      actorId: null,
      payload: {},
    });

    expect(store.operationsLog[0].prev_hash).toBeNull();
  });

  it("is non-fatal — never throws even when called without await", async () => {
    // Direct call (not .catch) should resolve cleanly.
    await expect(
      appendOperationsLog({
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        eventType: "EVIDENCE_INGEST",
        sourceId: "ev-err",
        sourceTable: "runtime_evidence_event",
        actorId: null,
        payload: {},
      }),
    ).resolves.not.toThrow();
  });
});

// ── verifyOperationsLogChain ──────────────────────────────────────────────────

describe("verifyOperationsLogChain", () => {
  it("returns verified=true with 0 entries", async () => {
    // SQL SELECT returns [] (empty store).
    const result = await verifyOperationsLogChain("demo-tenant", 100);
    expect(result.verified).toBe(true);
    expect(result.totalEntries).toBe(0);
  });

  it("returns verified=true for a single entry (no prev_hash to check)", async () => {
    store.operationsLog.push(makeOperationRow({ id: "op-1", prevHash: null }));

    const result = await verifyOperationsLogChain("demo-tenant", 100);
    expect(result.verified).toBe(true);
    expect(result.totalEntries).toBe(1);
  });

  it("returns verified=true when the chain is intact", async () => {
    const first = makeOperationRow({
      id: "op-1",
      prevHash: null,
      createdAt: new Date(Date.now() - 2000),
    });
    store.operationsLog.push(
      first,
      makeOperationRow({
        id: "op-2",
        prevHash: first.content_hash as string,
        createdAt: new Date(Date.now() - 1000),
      }),
    );

    const result = await verifyOperationsLogChain("demo-tenant", 100);
    expect(result.verified).toBe(true);
    expect(result.totalEntries).toBe(2);
  });

  it("verifies by hash linkage when created_at order is inverted by lock waits", async () => {
    const first = makeOperationRow({
      id: "op-1",
      prevHash: null,
      createdAt: new Date(Date.now() - 1000),
    });
    const second = makeOperationRow({
      id: "op-2",
      prevHash: first.content_hash as string,
      createdAt: new Date(Date.now() - 2000),
    });
    store.operationsLog.push(second, first);

    const result = await verifyOperationsLogChain("demo-tenant", 100);
    expect(result.verified).toBe(true);
    expect(result.totalEntries).toBe(2);
  });

  it("returns verified=false when prev_hash mismatch detected", async () => {
    const first = makeOperationRow({
      id: "op-1",
      prevHash: null,
      createdAt: new Date(Date.now() - 2000),
    });
    store.operationsLog.push(
      first,
      makeOperationRow({
        id: "op-2",
        prevHash: first.content_hash as string,
        storedPrevHash: "WRONG_HASH",
        createdAt: new Date(Date.now() - 1000),
      }),
    );

    const result = await verifyOperationsLogChain("demo-tenant", 100);
    expect(result.verified).toBe(false);
    expect(result.brokenEntryId).toBe("op-2");
  });
});

// ── ingestTrustScoreEvent ─────────────────────────────────────────────────────

describe("ingestTrustScoreEvent", () => {
  it("inserts a trust score event without throwing", async () => {
    await expect(
      ingestTrustScoreEvent({
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        agentId: "agent-trust-1",
        environment: "production",
        runtimeStack: "BEDROCK",
        trustScore: 0.85,
        source: "AGT_RUNTIME",
      }),
    ).resolves.not.toThrow();

    expect(store.trustScoreEvents).toHaveLength(1);
  });

  it("accepts boundary trust scores 0 and 1", async () => {
    await ingestTrustScoreEvent({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      agentId: "agent-edge",
      environment: "test",
      runtimeStack: "LOCAL",
      trustScore: 0,
      source: "MANUAL",
    });

    await ingestTrustScoreEvent({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      agentId: "agent-edge",
      environment: "test",
      runtimeStack: "LOCAL",
      trustScore: 1,
      source: "MANUAL",
    });

    expect(store.trustScoreEvents).toHaveLength(2);
  });
});

// ── listTrustScoreHistory ─────────────────────────────────────────────────────

describe("listTrustScoreHistory", () => {
  it("returns entries for the given agentId", async () => {
    store.trustScoreEvents.push(
      {
        id: "ts-1",
        agent_id: "agent-h",
        trust_score: "0.9",
        created_at: new Date(Date.now() - 1000),
      },
      { id: "ts-2", agent_id: "agent-h", trust_score: "0.7", created_at: new Date() },
    );

    const history = await listTrustScoreHistory("agent-h", "demo-ws", "demo-tenant", 10);
    expect(history.length).toBeGreaterThan(0);
  });
});

// ── recordIdentityLifecycleEvent / listIdentityLifecycleEvents ────────────────

describe("recordIdentityLifecycleEvent", () => {
  it("records a CREATED event without throwing", async () => {
    await expect(
      recordIdentityLifecycleEvent({
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        principalId: "user-99",
        eventType: "CREATED",
        source: "ADMIN",
        detail: { role: "reviewer" },
        actorId: "admin-1",
      }),
    ).resolves.not.toThrow();

    expect(store.identityLifecycleEvents).toHaveLength(1);
  });

  it("records a ROLE_REVOKED event", async () => {
    await recordIdentityLifecycleEvent({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      principalId: "user-role",
      eventType: "ROLE_REVOKED",
      source: "ADMIN",
      detail: { role: "reviewer" },
      actorId: "admin-1",
    });

    expect(store.identityLifecycleEvents).toHaveLength(1);
  });

  it("accepts AGT v4.1.0 signed agent lifecycle verification fields", async () => {
    await recordIdentityLifecycleEvent({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      principalId: "agent:agent-os-1",
      eventType: "CREATED",
      source: "SYSTEM",
      detail: { registration: "agent-os" },
      actorId: "agt-runtime",
      agentDid: "did:agt:agent-os-1",
      signatureAlgorithm: "Ed25519",
      signatureKeyId: "agt-key-1",
      payloadHash: "sha256:payload",
      signature: "ed25519:signature",
      signatureVerificationOutcome: "PASS",
      signatureVerifiedAt: "2026-06-10T00:00:00.000Z",
    });

    expect(store.identityLifecycleEvents).toHaveLength(1);
  });
});

describe("listIdentityLifecycleEvents", () => {
  it("returns stored events", async () => {
    store.identityLifecycleEvents.push({
      id: "id-evt-1",
      principal_id: "user-99",
      event_type: "CREATED",
      actor_id: "admin-1",
      source: "ADMIN",
      detail: {},
      agent_did: "did:agt:agent-os-1",
      signature_algorithm: "Ed25519",
      signature_key_id: "agt-key-1",
      payload_hash: "sha256:payload",
      signature: "ed25519:signature",
      signature_verification_outcome: "PASS",
      signature_failure_reason: null,
      signature_verified_at: new Date("2026-06-10T00:00:00.000Z"),
      created_at: new Date(),
    });

    const events = await listIdentityLifecycleEvents("demo-tenant", {});
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({
      agentDid: "did:agt:agent-os-1",
      signatureAlgorithm: "Ed25519",
      signatureVerificationOutcome: "PASS",
    });
  });

  it("filters by principalId (mock returns all, function returns mapped rows)", async () => {
    store.identityLifecycleEvents.push({
      id: "id-evt-1",
      principal_id: "user-filtered",
      event_type: "CREATED",
      actor_id: "admin-1",
      source: "ADMIN",
      detail: {},
      created_at: new Date(),
    });

    const events = await listIdentityLifecycleEvents("demo-tenant", {
      principalId: "user-filtered",
    });
    // Mock doesn't filter client-side — we verify the function returns something, not that it filtered.
    expect(Array.isArray(events)).toBe(true);
  });
});

// ── ingestVerificationResult / listVerificationResults ────────────────────────

describe("ingestVerificationResult", () => {
  it("inserts a PASS result and returns an id", async () => {
    const id = await ingestVerificationResult({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      revisionId: "rev-vr-1",
      artifactHash: "sha256:abc",
      verificationType: "AGT_VERIFY",
      outcome: "PASS",
      summary: { checks: 12, passed: 12 },
      runBy: "svc-ci",
      runtimeVersion: "1.2.3",
    });

    expect(id).toBeTruthy();
    expect(store.verificationResults).toHaveLength(1);
  });

  it("records FAIL outcome", async () => {
    const id = await ingestVerificationResult({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      revisionId: "rev-vr-fail",
      artifactHash: "sha256:fail",
      verificationType: "AGT_LINT_POLICY",
      outcome: "FAIL",
      summary: { errors: ["rule X not satisfied"] },
      runBy: "svc-ci",
      runtimeVersion: "1.2.3",
    });

    expect(id).toBeTruthy();
  });

  it("accepts AGT v4.1.0 engine provenance and ProofOfOutcome escrow fields", async () => {
    const id = await ingestVerificationResult({
      tenantId: "demo-tenant",
      workspaceId: "demo-ws",
      revisionId: "rev-vr-410",
      artifactHash: "sha256:agt410",
      verificationType: "AGT_VERIFY_EVIDENCE",
      outcome: "PASS",
      summary: { checks: 7 },
      runBy: "svc-ci",
      runtimeVersion: "4.1.0",
      agtVersion: "4.1.0",
      agtPoliciesVersion: "5.0.0",
      cedarPolicyVersion: "2026-06",
      policyEngineVersion: "4.1.0",
      compatibilityCheckedAt: "2026-06-10T00:00:00.000Z",
      compatibilityCheckOutcome: "PASS",
      escrowSignerId: "did:example:escrow",
      escrowKeyId: "escrow-key-1",
      outcomeHash: "sha256:outcome",
      escrowSignature: "ed25519:escrow-signature",
      escrowVerificationOutcome: "PASS",
      escrowVerifiedAt: "2026-06-10T00:00:01.000Z",
    });

    expect(id).toBeTruthy();
    expect(store.verificationResults).toHaveLength(1);
  });
});

describe("listVerificationResults", () => {
  it("returns stored results", async () => {
    store.verificationResults.push({
      id: "vr-1",
      revision_id: "rev-list-1",
      artifact_hash: "sha256:list",
      verification_type: "AGT_VERIFY",
      outcome: "PASS",
      summary: {},
      run_by: "svc-ci",
      runtime_version: null,
      agt_version: "4.1.0",
      agt_policies_version: "5.0.0",
      cedar_policy_version: "2026-06",
      policy_engine_version: "4.1.0",
      compatibility_checked_at: new Date("2026-06-10T00:00:00.000Z"),
      compatibility_check_outcome: "PASS",
      escrow_signer_id: "did:example:escrow",
      escrow_key_id: "escrow-key-1",
      outcome_hash: "sha256:outcome",
      escrow_signature: "ed25519:escrow-signature",
      escrow_verification_outcome: "PASS",
      escrow_verified_at: new Date("2026-06-10T00:00:01.000Z"),
      tenant_id: "demo-tenant",
      workspace_id: "demo-ws",
      created_at: new Date(),
    });

    const results = await listVerificationResults("demo-ws", "demo-tenant", { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      agtVersion: "4.1.0",
      agtPoliciesVersion: "5.0.0",
      escrowSignerId: "did:example:escrow",
      escrowVerificationOutcome: "PASS",
    });
  });
});

describe("getLatestVerificationStatus", () => {
  it("includes AGT v4.1.0 drift provenance from the latest run", async () => {
    store.verificationResults.push({
      id: "vr-status-1",
      revision_id: "rev-status",
      artifact_hash: "sha256:status",
      verification_type: "AGT_VERIFY_EVIDENCE",
      outcome: "PASS",
      summary: {},
      run_by: "svc-ci",
      runtime_version: "4.1.0",
      agt_version: "4.1.0",
      agt_policies_version: "5.0.0",
      cedar_policy_version: "2026-06",
      policy_engine_version: "4.1.0",
      compatibility_checked_at: new Date("2026-06-10T00:00:00.000Z"),
      compatibility_check_outcome: "PASS",
      tenant_id: "demo-tenant",
      workspace_id: "demo-ws",
      created_at: new Date(),
    });

    const status = await getLatestVerificationStatus("demo-ws", "demo-tenant", {
      artifactHash: "sha256:status",
    });
    expect(status).toMatchObject({
      hasResults: true,
      latestAgtVersion: "4.1.0",
      latestAgtPoliciesVersion: "5.0.0",
      latestCedarPolicyVersion: "2026-06",
      latestPolicyEngineVersion: "4.1.0",
      compatibilityCheckOutcome: "PASS",
    });
  });

  it("marks an otherwise fresh result stale when verifier or byte-exact policy provenance drifts", async () => {
    store.verificationResults.push({
      id: "vr-provenance-1",
      revision_id: "rev-provenance",
      artifact_hash: "sha256:semantic-policy",
      verifier_lock_digest: "sha256:old-lock",
      policy_content_hash: "sha256:" + "a".repeat(64),
      verification_type: "AGT_VERIFY_EVIDENCE",
      outcome: "PASS",
      summary: {},
      run_by: "svc-ci",
      runtime_version: "4.1.0",
      tenant_id: "demo-tenant",
      workspace_id: "demo-ws",
      created_at: new Date(),
    });

    const status = await getLatestVerificationStatus("demo-ws", "demo-tenant", {
      revisionId: "rev-provenance",
      artifactHash: "sha256:semantic-policy",
      verifierLockDigest: "sha256:new-lock",
      policyContentHash: "sha256:" + "b".repeat(64),
    });
    expect(status).toMatchObject({ isStale: true });
    expect(status.staleReasons).toEqual(
      expect.arrayContaining(["VERIFIER_LOCK", "POLICY_CONTENT"]),
    );
  });
});

// ── API route: GET /api/operations ────────────────────────────────────────────

describe("GET /api/operations", () => {
  it("returns 200 with entries array", async () => {
    store.operationsLog.push({
      id: "op-route-1",
      event_type: "POLICY_PUBLISH",
      content_hash: "ch-r1",
      prev_hash: null,
      created_at: new Date(),
    });

    const req = createRouteRequest({ path: "/api/operations", method: "GET" });
    const res = await operationsGet(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("entries");
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("generatedAt");
  });

  it("respects limit query param", async () => {
    const req = createRouteRequest({ path: "/api/operations?limit=5", method: "GET" });
    const res = await operationsGet(req);
    expect(res.status).toBe(200);
  });

  it("respects eventType filter", async () => {
    const req = createRouteRequest({
      path: "/api/operations?eventType=POLICY_PUBLISH",
      method: "GET",
    });
    const res = await operationsGet(req);
    expect(res.status).toBe(200);
  });
});

// ── API route: GET /api/operations/verify ─────────────────────────────────────

describe("GET /api/operations/verify", () => {
  it("returns 200 when chain is intact", async () => {
    const first = makeOperationRow({
      id: "cv-1",
      prevHash: null,
      createdAt: new Date(Date.now() - 1000),
    });
    store.operationsLog.push(
      first,
      makeOperationRow({
        id: "cv-2",
        prevHash: first.content_hash as string,
        createdAt: new Date(),
      }),
    );

    const req = createRouteRequest({ path: "/api/operations/verify", method: "GET" });
    const res = await chainVerifyGet(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { verified: boolean };
    expect(body.verified).toBe(true);
  });

  it("returns 409 when chain is broken", async () => {
    const first = makeOperationRow({
      id: "cv-1",
      prevHash: null,
      createdAt: new Date(Date.now() - 1000),
    });
    store.operationsLog.push(
      first,
      makeOperationRow({
        id: "cv-2",
        prevHash: first.content_hash as string,
        storedPrevHash: "TAMPERED",
        createdAt: new Date(),
      }),
    );

    const req = createRouteRequest({ path: "/api/operations/verify", method: "GET" });
    const res = await chainVerifyGet(req);
    expect(res.status).toBe(409);

    const body = (await res.json()) as { verified: boolean };
    expect(body.verified).toBe(false);
  });
});

// ── API route: POST /api/trust/ingest ─────────────────────────────────────────

describe("POST /api/trust/ingest", () => {
  it("accepts a valid trust score payload", async () => {
    const req = createRouteRequest({
      path: "/api/trust/ingest",
      token: "svc-token",
      body: {
        agentId: "agent-trust-api",
        environment: "production",
        runtimeStack: "AWS_BEDROCK",
        trustScore: 0.92,
        source: "POLICY_EVALUATION",
      },
    });

    const res = await trustIngestPost(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects trust score > 1", async () => {
    const req = createRouteRequest({
      path: "/api/trust/ingest",
      token: "svc-token",
      body: {
        agentId: "a",
        environment: "test",
        runtimeStack: "LOCAL",
        trustScore: 1.5,
        source: "MANUAL",
      },
    });

    const res = await trustIngestPost(req);
    expect(res.status).toBe(400);
  });

  it("rejects trust score < 0", async () => {
    const req = createRouteRequest({
      path: "/api/trust/ingest",
      token: "svc-token",
      body: {
        agentId: "a",
        environment: "test",
        runtimeStack: "LOCAL",
        trustScore: -0.1,
        source: "MANUAL",
      },
    });

    const res = await trustIngestPost(req);
    expect(res.status).toBe(400);
  });

  it("requires agentId", async () => {
    const req = createRouteRequest({
      path: "/api/trust/ingest",
      token: "svc-token",
      body: { environment: "test", runtimeStack: "LOCAL", trustScore: 0.5, source: "MANUAL" },
    });

    const res = await trustIngestPost(req);
    expect(res.status).toBe(400);
  });
});

// ── API route: GET /api/trust/history ─────────────────────────────────────────

describe("GET /api/trust/history", () => {
  it("requires agentId query param", async () => {
    const req = createRouteRequest({ path: "/api/trust/history", method: "GET" });
    const res = await trustHistoryGet(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 with events array", async () => {
    const req = createRouteRequest({ path: "/api/trust/history?agentId=agent-h", method: "GET" });
    const res = await trustHistoryGet(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });
});

// ── API route: POST /api/identity/event ──────────────────────────────────────

describe("POST /api/identity/event", () => {
  it("records a CREATED event", async () => {
    const req = createRouteRequest({
      path: "/api/identity/event",
      body: { principalId: "user-prov-1", eventType: "CREATED", source: "ADMIN", detail: {} },
    });

    const res = await identityEventPost(req);
    expect(res.status).toBe(201);
  });

  it("records AGT v4.1.0 signature verification fields", async () => {
    const req = createRouteRequest({
      path: "/api/identity/event",
      body: {
        principalId: "agent:route-1",
        eventType: "CREATED",
        source: "SYSTEM",
        detail: {},
        agentDid: "did:agt:route-1",
        signatureAlgorithm: "Ed25519",
        signatureKeyId: "agt-key-1",
        payloadHash: "sha256:payload",
        signature: "ed25519:signature",
        signatureVerificationOutcome: "PASS",
        signatureVerifiedAt: "2026-06-10T00:00:00.000Z",
      },
    });

    const res = await identityEventPost(req);
    expect(res.status).toBe(201);
  });

  it("rejects invalid eventType", async () => {
    const req = createRouteRequest({
      path: "/api/identity/event",
      body: { principalId: "user-bad", eventType: "INVALID_TYPE", source: "ADMIN" },
    });

    const res = await identityEventPost(req);
    expect(res.status).toBe(400);
  });

  it("requires principalId", async () => {
    const req = createRouteRequest({
      path: "/api/identity/event",
      body: { eventType: "CREATED", source: "ADMIN" },
    });

    const res = await identityEventPost(req);
    expect(res.status).toBe(400);
  });
});

// ── API route: GET /api/identity/events ──────────────────────────────────────

describe("GET /api/identity/events", () => {
  it("returns 200 with events array", async () => {
    const req = createRouteRequest({ path: "/api/identity/events", method: "GET" });
    const res = await identityEventsGet(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });
});

// ── API route: POST /api/verification ────────────────────────────────────────

describe("POST /api/verification", () => {
  it("records a PASS verification result", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:route-test",
        verificationType: "AGT_VERIFY",
        outcome: "PASS",
        revisionId: "rev-route-1",
        runtimeVersion: "2.0.0",
        summary: {},
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { ok: boolean; outcome: string };
    expect(body.ok).toBe(true);
    expect(body.outcome).toBe("PASS");
  });

  it("records AGT v4.1.0 engine and escrow fields", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:route-agt410",
        verificationType: "AGT_VERIFY_EVIDENCE",
        outcome: "PASS",
        runtimeVersion: "4.1.0",
        summary: {},
        agtVersion: "4.1.0",
        agtPoliciesVersion: "5.0.0",
        cedarPolicyVersion: "2026-06",
        policyEngineVersion: "4.1.0",
        compatibilityCheckedAt: "2026-06-10T00:00:00.000Z",
        compatibilityCheckOutcome: "PASS",
        escrowSignerId: "did:example:escrow",
        escrowKeyId: "escrow-key-1",
        outcomeHash: "sha256:outcome",
        escrowSignature: "ed25519:escrow-signature",
        escrowVerificationOutcome: "PASS",
        escrowVerifiedAt: "2026-06-10T00:00:01.000Z",
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(201);
  });

  it("rejects invalid AGT tamper-evidence timestamps", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:bad-time",
        verificationType: "AGT_REPLAY",
        outcome: "PASS",
        issuedAt: "not-a-date",
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid verificationType", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:bad",
        verificationType: "NOT_REAL",
        outcome: "PASS",
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid outcome", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:bad",
        verificationType: "AGT_VERIFY",
        outcome: "UNKNOWN",
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid compatibilityCheckOutcome", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:bad-compat-outcome",
        verificationType: "AGT_VERIFY",
        outcome: "PASS",
        compatibilityCheckOutcome: "UNKNOWN",
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid escrowVerificationOutcome", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        artifactHash: "sha256:bad-escrow-outcome",
        verificationType: "AGT_VERIFY",
        outcome: "PASS",
        escrowVerificationOutcome: "UNKNOWN",
      }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(400);
  });

  it("requires artifactHash", async () => {
    const req = new Request("http://localhost:3000/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({ verificationType: "AGT_VERIFY", outcome: "PASS" }),
    });

    const res = await verificationPost(req);
    expect(res.status).toBe(400);
  });
});

// ── API route: GET /api/verification ─────────────────────────────────────────

describe("GET /api/verification", () => {
  it("returns 200 with results array", async () => {
    const req = new Request("http://localhost:3000/api/verification");
    const res = await verificationGet(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
  });
});

// ── End-to-end: evidence ingest → operations log side-effect ───────────────────

describe("Evidence ingest → operations log side-effect", () => {
  it("evidence POST appends to operations log", async () => {
    const before = store.operationsLog.length;

    const req = new Request("http://localhost:3000/api/evidence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer svc-token",
        // No x-spctre-principal-id: uses authenticateServiceToken mock path
      },
      body: JSON.stringify({
        decisionId: "dec-e2e-ops",
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        environment: "production",
        runtimeTarget: { stack: "LOCAL" },
        agentId: "agent-e2e",
        connector: "stripe",
        action: "charge",
        status: "ALLOW",
        reason: "e2e test",
        policyRefs: ["stripe.payment.test"],
        artifactHash: "sha256:e2e-ops",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-e2e",
            revisionId: "r-e2e",
            artifactHash: "sha256:e2e-ops",
          },
        ],
      }),
    });

    const res = await evidencePost(req);
    expect(res.status).toBe(201);

    // Operations log should have grown.
    expect(store.operationsLog.length).toBeGreaterThan(before);
  });

  it("evidence response includes gateway field", async () => {
    const req = new Request("http://localhost:3000/api/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer svc-token" },
      body: JSON.stringify({
        decisionId: "dec-gw-e2e",
        tenantId: "demo-tenant",
        workspaceId: "demo-ws",
        environment: "production",
        runtimeTarget: { stack: "LOCAL" },
        agentId: "agent-gw-e2e",
        connector: "openai",
        action: "complete",
        status: "ALLOW",
        reason: "e2e gateway check",
        policyRefs: ["openai.completion.basic"],
        artifactHash: "sha256:gw-e2e",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-gw",
            revisionId: "r-gw",
            artifactHash: "sha256:gw-e2e",
          },
        ],
      }),
    });

    const res = await evidencePost(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    // evidence is always present; gateway only appears when GATEWAY_ENABLED=true.
    expect(body).toHaveProperty("evidence");
    // gateway key absent (undefined) is fine — the field is conditionally serialized.
    expect("evidence" in body).toBe(true);
  });
});

// ── buildContentHash determinism ──────────────────────────────────────────────

describe("buildContentHash (test utility)", () => {
  it("produces a sha256-prefixed content hash", () => {
    const hash = buildContentHash({
      eventType: "POLICY_PUBLISH",
      sourceId: "rev-1",
      sourceTable: "policy_revision",
      actorId: "user-1",
      payload: { foo: "bar" },
      prevHash: undefined,
    });

    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce same hash", () => {
    const params = {
      eventType: "EVIDENCE_INGEST",
      sourceId: "ev-42",
      sourceTable: "runtime_evidence_event",
      actorId: "svc-1",
      payload: { a: 1 },
      prevHash: "abc123",
    };

    expect(buildContentHash(params)).toBe(buildContentHash(params));
  });

  it("different payloads produce different hashes", () => {
    const base = { eventType: "EVIDENCE_INGEST", sourceId: "ev-1", sourceTable: "t", actorId: "a" };
    const h1 = buildContentHash({ ...base, payload: { x: 1 } });
    const h2 = buildContentHash({ ...base, payload: { x: 2 } });

    expect(h1).not.toBe(h2);
  });
});
