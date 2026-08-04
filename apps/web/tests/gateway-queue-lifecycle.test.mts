/**
 * Gateway queue lifecycle and publish-gating integration tests.
 *
 * Covers:
 * - evaluateGatewayDecision outcomes (PROCEED / ESCALATE / ABORT)
 * - Evidence ingest triggering gateway evaluation when GATEWAY_ENABLED
 * - Publish gating: unresolved escalations block publish
 * - Queue resolve path (API route contract)
 * - Edge cases: SLA thresholds, ABORT never queues, duplicate decision handling
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleValidationSelect } from "./sql-mock-helper";

// ── Mock setup ────────────────────────────────────────────────────────────────

let insertedRows: string[] = [];
let conflictDecision = false;
let resolvedQueueIds = new Map<string, { outcome: string; note: string | null }>();
let queueResolveUpdates = 0;
let lastGatewayDecisionArgs: unknown[] = [];
let lastEvidenceArgs: unknown[] = [];
const getLatestPublishedPolicyBundleSpy = vi.fn();

function makeSqlMock() {
  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("").replace(/\s+/g, " ").trim().toUpperCase();

    if (joined.startsWith("INSERT INTO RUNTIME_EVIDENCE_EVENT_KEY")) {
      if (conflictDecision) return Promise.resolve([]);
      return Promise.resolve([{ decision_id: "dec-1" }]);
    }
    if (joined.startsWith("INSERT INTO RUNTIME_EVIDENCE_EVENT")) {
      insertedRows.push("evidence");
      lastEvidenceArgs = args;
      return Promise.resolve([{ id: "ev-uuid-1", decision_id: "dec-1", created_at: new Date() }]);
    }
    if (joined.startsWith("INSERT INTO GATEWAY_DECISION")) {
      insertedRows.push("gateway_decision");
      lastGatewayDecisionArgs = args;
      return Promise.resolve([{ id: "gd-uuid-1" }]);
    }
    if (joined.startsWith("INSERT INTO GATEWAY_ESCALATION_QUEUE")) {
      insertedRows.push("escalation_queue");
      return Promise.resolve([{ id: "eq-uuid-1" }]);
    }
    if (
      joined.includes("FROM GATEWAY_ESCALATION_QUEUE") &&
      joined.includes("STATUS") &&
      !joined.startsWith("UPDATE")
    ) {
      const queueId = args[1] as string;
      const resolved = resolvedQueueIds.get(queueId);
      if (resolved) {
        return Promise.resolve([
          {
            status: "RESOLVED",
            resolution_outcome: resolved.outcome,
            resolution_note: resolved.note,
            agent_guidance: (resolved as any).agentGuidance ?? null,
          },
        ]);
      }
      return Promise.resolve([
        {
          status: "PENDING",
          resolution_outcome: null,
          resolution_note: null,
          agent_guidance: null,
        },
      ]);
    }
    if (joined.includes("UPDATE GATEWAY_ESCALATION_QUEUE")) {
      const resolutionOutcome = args[1] as string;
      const resolutionNote = (args[2] as string | null | undefined) ?? null;
      const agentGuidance = (args[3] as string | null | undefined) ?? null;
      const queueId = args[4] as string;
      queueResolveUpdates += 1;
      resolvedQueueIds.set(queueId, {
        outcome: resolutionOutcome,
        note: resolutionNote,
        agentGuidance,
      } as any);
      return Promise.resolve([{ id: "eq-uuid-1" }]);
    }
    if (joined.includes("UPDATE GATEWAY_DECISION")) {
      return Promise.resolve([]);
    }
    const valResult = handleValidationSelect(joined, args);
    if (valResult) {
      return Promise.resolve(valResult);
    }
    // SELECT queries (auth checks, workspace checks, etc.) → always valid row.
    return Promise.resolve([{ id: "row-exists", count: "0" }]);
  };
  return Object.assign(fn, {
    begin: vi.fn(async (callback: (tx: typeof fn) => Promise<unknown>) => callback(fn)),
    // Mirrors postgres' sql.json(): the persisted jsonb payload is the
    // serialized value (a string param, not a JS array).
    json: (value: unknown) => JSON.stringify(value),
  });
}

const sqlMock = makeSqlMock();

vi.mock("@/lib/db", () => ({ sql: sqlMock }));

vi.mock("@/lib/domains/policy/service", () => ({
  getLatestPublishedPolicyBundle: getLatestPublishedPolicyBundleSpy,
}));

vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "demo-tenant",
  DEMO_WORKSPACE_ID: "demo-workspace",
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({
  ensureDemoTenant: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi
    .fn()
    .mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "22222222-2222-4222-8222-222222222222",
        workspaceId: "regular-workspace",
        principalId: "svc-gateway-test",
        scopes: ["evidence:write"],
      },
    }),
  // Return true only when an Authorization header is present so that the
  // evidence route (which always sends one) uses token auth, while the
  // gateway decide/resolve routes (which don't) fall through to session auth.
  hasBearerToken: (req: Request) => (req.headers.get("authorization") ?? "").startsWith("Bearer "),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ principalId: "reviewer-1" }),
}));

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: vi
    .fn()
    .mockResolvedValue({
      tenantId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "regular-workspace",
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@spctre/policy-schema", async (importOriginal) => {
  const real = await importOriginal<typeof import("@spctre/policy-schema")>();
  return {
    ...real,
    ingestAgtRuntimeDecision: (input: Record<string, unknown>) => ({
      decisionId: input.decisionId,
      tenantId: input.tenantId ?? "demo-tenant",
      workspaceId: input.workspaceId ?? "demo-workspace",
      environment: input.environment,
      runtimeTarget: input.runtimeTarget,
      agentId: input.agentId,
      connector: input.connector,
      action: input.action,
      status: input.status,
      reason: input.reason,
      policyRefs: input.policyRefs,
      artifactHash: input.artifactHash,
      policyContext: input.policyContext,
      latencyMs: input.latencyMs ?? 0,
      createdAt: input.createdAt ?? new Date().toISOString(),
      rawEvidence: input.rawEvidence ?? {},
      toolIntent: input.toolIntent,
      planSummary: input.planSummary,
      toolParameters: input.toolParameters,
    }),
  };
});

// Import from the mocked module — evaluateGatewayDecision comes through via importOriginal spread.
const { evaluateGatewayDecision } = await import("@spctre/policy-schema");
const { getActiveScope } = await import("@/lib/workspace/scope");
const getActiveScopeMock = vi.mocked(getActiveScope);

// Import routes after mocks are registered.
const { POST: evidencePost } = await import("../app/api/evidence/route");
const { POST: resolvePost } = await import("../app/api/gateway/resolve/route");
const { POST: decidePost } = await import("../app/api/gateway/decide/route");

const DEMO_TOKEN = "demo-token-gateway-tests";

function buildEvidenceRequest(
  decisionId: string,
  gatewayFields: Record<string, unknown> = {},
): Request {
  return new Request("http://localhost:3000/api/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEMO_TOKEN}` },
    body: JSON.stringify({
      decisionId,
      tenantId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "regular-workspace",
      environment: "production",
      runtimeTarget: { stack: "LOCAL" },
      agentId: "agent-gw-1",
      connector: "stripe",
      action: "charge",
      status: "ALLOW",
      reason: "gateway test decision",
      policyRefs: ["stripe.payment.authorize"],
      artifactHash: "sha256:gateway-test",
      policyContext: [
        {
          scope: "WORKSPACE",
          branchId: "b-gw-1",
          revisionId: "r-gw-1",
          artifactHash: "sha256:gateway-test",
        },
      ],
      ...gatewayFields,
    }),
  });
}

// ── Evaluator unit tests ──────────────────────────────────────────────────────

describe("evaluateGatewayDecision — outcome logic", () => {
  it("returns PROCEED for low-risk inputs with no gateway fields", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-low",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
    });
    expect(result.outcome).toBe("PROCEED");
    expect(result.shouldQueue).toBe(false);
    expect(result.riskLevel).toBe("LOW");
  });

  it("returns ESCALATE for HIGH consequence", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-high",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      consequence: "HIGH",
    });
    expect(result.outcome).toBe("ESCALATE");
    expect(result.shouldQueue).toBe(true);
    expect(result.slaHours).toBe(4);
    expect(result.riskLevel).toBe("HIGH");
  });

  it("returns ESCALATE for low confidence (< 0.6)", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-conf",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      confidence: 0.55,
    });
    expect(result.outcome).toBe("ESCALATE");
    expect(result.shouldQueue).toBe(true);
  });

  it("returns ESCALATE for low trust score (< 0.45)", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-trust",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      trustScore: 0.4,
    });
    expect(result.outcome).toBe("ESCALATE");
    expect(result.shouldQueue).toBe(true);
  });

  it("returns ESCALATE for amount >= $10,000", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-amt",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      amountUsd: 15000,
    });
    expect(result.outcome).toBe("ESCALATE");
    expect(result.shouldQueue).toBe(true);
  });

  it("returns ABORT for PROHIBITED consequence — never queued", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-abort",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      consequence: "PROHIBITED",
    });
    expect(result.outcome).toBe("ABORT");
    expect(result.shouldQueue).toBe(false);
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("returns ABORT for trust < 0.2 AND amount >= $50k", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-abort2",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      trustScore: 0.1,
      amountUsd: 75000,
    });
    expect(result.outcome).toBe("ABORT");
    expect(result.shouldQueue).toBe(false);
  });

  it("returns ABORT for trust < 0.2 AND data sensitivity RESTRICTED", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-abort3",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      trustScore: 0.15,
      dataSensitivity: "RESTRICTED",
    });
    expect(result.outcome).toBe("ABORT");
    expect(result.shouldQueue).toBe(false);
  });

  it("ESCALATE takes priority over low confidence even when amount is below threshold", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-multi",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      confidence: 0.3,
      amountUsd: 500,
    });
    expect(result.outcome).toBe("ESCALATE");
  });

  it("PROCEED for trust at exactly 0.45 (boundary: < 0.45 triggers, = 0.45 does not)", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-boundary",
      artifactHash: "sha256:abc",
      policyContext: [
        { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" },
      ],
      trustScore: 0.45,
    });
    expect(result.outcome).toBe("PROCEED");
  });
});

// ── Evidence ingest + gateway integration ─────────────────────────────────────

describe("Evidence ingest with GATEWAY_ENABLED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows = [];
    conflictDecision = false;
    resolvedQueueIds = new Map();
    queueResolveUpdates = 0;
    process.env.GATEWAY_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.GATEWAY_ENABLED;
  });

  it("low-risk evidence ingests without creating an escalation queue entry", async () => {
    const res = await evidencePost(buildEvidenceRequest("dec-gw-low"));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      evidence: unknown;
      gateway?: { outcome: string; shouldQueue: boolean };
    };
    expect(body.gateway?.outcome).toBe("PROCEED");
    expect(body.gateway?.shouldQueue).toBe(false);
    expect(insertedRows).toContain("evidence");
    expect(insertedRows).toContain("gateway_decision");
    expect(insertedRows).not.toContain("escalation_queue");
  });

  it("high-risk evidence creates an escalation queue entry", async () => {
    const res = await evidencePost(buildEvidenceRequest("dec-gw-high", { amountUsd: 25000 }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { gateway?: { outcome: string; shouldQueue: boolean } };
    expect(body.gateway?.outcome).toBe("ESCALATE");
    expect(body.gateway?.shouldQueue).toBe(true);
    expect(insertedRows).toContain("escalation_queue");
  });

  it("ABORT outcome does not create an escalation queue entry", async () => {
    const res = await evidencePost(
      buildEvidenceRequest("dec-gw-abort", { consequence: "PROHIBITED" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { gateway?: { outcome: string; shouldQueue: boolean } };
    expect(body.gateway?.outcome).toBe("ABORT");
    expect(body.gateway?.shouldQueue).toBe(false);
    expect(insertedRows).not.toContain("escalation_queue");
  });

  it("gateway disabled — no gateway_decision row, no gateway field in response", async () => {
    process.env.GATEWAY_ENABLED = "false";
    const res = await evidencePost(buildEvidenceRequest("dec-gw-disabled"));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { gateway?: unknown };
    expect(body.gateway).toBeUndefined();
    expect(insertedRows).not.toContain("gateway_decision");
  });

  it("duplicate evidence is suppressed and gateway block is never reached", async () => {
    conflictDecision = true;
    const res = await evidencePost(buildEvidenceRequest("dec-gw-dedup"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduplicated: boolean };
    expect(body.deduplicated).toBe(true);
    expect(insertedRows).not.toContain("gateway_decision");
  });
});

// ── Publish gating: queue/escalation semantics ────────────────────────────────

describe("Publish gating: shouldQueue semantics align with escalation count check", () => {
  it("ABORT outcome: shouldQueue=false, no queue entry raised", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-abort-pub",
      artifactHash: "sha256:publish-test",
      policyContext: [
        {
          scope: "WORKSPACE",
          branchId: "b-1",
          revisionId: "r-1",
          artifactHash: "sha256:publish-test",
        },
      ],
      consequence: "IRREVERSIBLE",
    });
    expect(result.outcome).toBe("ABORT");
    expect(result.shouldQueue).toBe(false);
  });

  it("ESCALATE outcome: shouldQueue=true with 4-hour SLA", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-escalate-pub",
      artifactHash: "sha256:publish-test",
      policyContext: [
        {
          scope: "WORKSPACE",
          branchId: "b-1",
          revisionId: "r-1",
          artifactHash: "sha256:publish-test",
        },
      ],
      dataSensitivity: "HIGH",
    });
    expect(result.outcome).toBe("ESCALATE");
    expect(result.shouldQueue).toBe(true);
    expect(result.slaHours).toBe(4);
  });

  it("PROCEED outcome: shouldQueue=false, publish is never blocked by gateway alone", () => {
    const result = evaluateGatewayDecision({
      decisionId: "dec-proceed-pub",
      artifactHash: "sha256:publish-test",
      policyContext: [
        {
          scope: "WORKSPACE",
          branchId: "b-1",
          revisionId: "r-1",
          artifactHash: "sha256:publish-test",
        },
      ],
    });
    expect(result.outcome).toBe("PROCEED");
    expect(result.shouldQueue).toBe(false);
  });
});

// ── Queue resolve API — input validation ─────────────────────────────────────

describe("Gateway resolve API — input validation", () => {
  beforeEach(() => {
    resolvedQueueIds = new Map();
    queueResolveUpdates = 0;
  });

  it("rejects request missing queueId", async () => {
    const req = new Request("http://localhost:3000/api/gateway/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionOutcome: "PROCEED" }),
    });
    const res = await resolvePost(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/queueId/i);
  });

  it("rejects invalid resolutionOutcome", async () => {
    const req = new Request("http://localhost:3000/api/gateway/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId: "q-1", resolutionOutcome: "MAYBE" }),
    });
    const res = await resolvePost(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/PROCEED|ESCALATE|ABORT/);
  });

  it("rejects demo tenant resolution attempts", async () => {
    getActiveScopeMock.mockResolvedValueOnce({
      tenantId: "demo-tenant",
      workspaceId: "demo-workspace",
    });

    const req = new Request("http://localhost:3000/api/gateway/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId: "q-demo", resolutionOutcome: "PROCEED" }),
    });
    const res = await resolvePost(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Demo Mode/i);
  });

  it("accepts PROCEED as a valid resolution outcome and returns ok", async () => {
    const req = new Request("http://localhost:3000/api/gateway/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queueId: "q-1",
        resolutionOutcome: "PROCEED",
        resolutionNote: "Reviewed and cleared.",
      }),
    });
    const res = await resolvePost(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("accepts ABORT as a valid resolution outcome", async () => {
    const req = new Request("http://localhost:3000/api/gateway/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId: "q-2", resolutionOutcome: "ABORT" }),
    });
    const res = await resolvePost(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("treats a repeated identical resolution as idempotent success", async () => {
    const requestBody = {
      queueId: "q-idempotent-1",
      resolutionOutcome: "PROCEED",
      resolutionNote: "Reviewed and cleared.",
    };

    const firstResponse = await resolvePost(
      new Request("http://localhost:3000/api/gateway/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }),
    );

    const secondResponse = await resolvePost(
      new Request("http://localhost:3000/api/gateway/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({ ok: true });
    expect(await secondResponse.json()).toMatchObject({ ok: true });
    expect(queueResolveUpdates).toBe(1);
  });
});

// ── Gateway decide API ────────────────────────────────────────────────────────

describe("Gateway decide API — outcome and queue routing", () => {
  beforeEach(() => {
    process.env.GATEWAY_ENABLED = "true";
    insertedRows = [];
    lastGatewayDecisionArgs = [];
    getLatestPublishedPolicyBundleSpy.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.GATEWAY_ENABLED;
  });

  it("returns PROCEED for low-risk inputs", async () => {
    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-decide-low",
        artifactHash: "sha256:decide-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-1",
            revisionId: "r-1",
            artifactHash: "sha256:decide-test",
          },
        ],
      }),
    });
    const res = await decidePost(req);
    const body = (await res.json()) as {
      decision: { outcome: string };
      gatewayEnabled: boolean;
      queued: boolean;
    };
    expect(body.gatewayEnabled).toBe(true);
    expect(body.decision.outcome).toBe("PROCEED");
    expect(body.queued).toBe(false);
  });

  it("returns ESCALATE and queued=true for high-risk input", async () => {
    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-decide-high",
        artifactHash: "sha256:decide-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-1",
            revisionId: "r-1",
            artifactHash: "sha256:decide-test",
          },
        ],
        consequence: "HIGH",
      }),
    });
    const res = await decidePost(req);
    const body = (await res.json()) as { decision: { outcome: string }; queued: boolean };
    expect(body.decision.outcome).toBe("ESCALATE");
    expect(body.queued).toBe(true);
  });

  it("escalates a low-risk request when the published policy requires HITL", async () => {
    getLatestPublishedPolicyBundleSpy.mockResolvedValue({
      bundle: {
        rules: [
          {
            stableRuleId: "scout.escalate_brief_file",
            title: "Every filed brief escalates for human review",
            effect: "ESCALATE",
            domains: [],
            connectors: ["acquisition-scout"],
            actions: ["brief.file"],
          },
        ],
      },
    });
    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-scout-brief",
        artifactHash: "sha256:decide-test",
        policyContext: [{ scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:decide-test" }],
        connector: "acquisition-scout",
        action: "brief.file",
      }),
    });
    const body = (await (await decidePost(req)).json()) as { decision: { outcome: string }; queued: boolean };
    expect(body.decision.outcome).toBe("ESCALATE");
    expect(body.queued).toBe(true);
  });

  it("gateway disabled — high-risk input still returns PROCEED and queued=false", async () => {
    process.env.GATEWAY_ENABLED = "false";
    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-decide-disabled",
        artifactHash: "sha256:decide-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-1",
            revisionId: "r-1",
            artifactHash: "sha256:decide-test",
          },
        ],
        consequence: "HIGH",
      }),
    });
    const res = await decidePost(req);
    const body = (await res.json()) as {
      decision: { outcome: string };
      queued: boolean;
      gatewayEnabled: boolean;
    };
    expect(body.gatewayEnabled).toBe(false);
    expect(body.decision.outcome).toBe("PROCEED");
    expect(body.queued).toBe(false);
  });

  it("ABORT outcome is returned correctly and queued=false", async () => {
    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-decide-abort",
        artifactHash: "sha256:decide-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-1",
            revisionId: "r-1",
            artifactHash: "sha256:decide-test",
          },
        ],
        consequence: "PROHIBITED",
      }),
    });
    const res = await decidePost(req);
    const body = (await res.json()) as { decision: { outcome: string }; queued: boolean };
    expect(body.decision.outcome).toBe("ABORT");
    expect(body.queued).toBe(false);
  });

  it("forces persisted=false and queued=false for demo tenant even if DB and gateway are enabled", async () => {
    getActiveScopeMock.mockResolvedValueOnce({
      tenantId: "demo-tenant",
      workspaceId: "demo-workspace",
    });

    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-decide-demo",
        artifactHash: "sha256:decide-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-1",
            revisionId: "r-1",
            artifactHash: "sha256:decide-test",
          },
        ],
        consequence: "HIGH",
      }),
    });
    const res = await decidePost(req);
    const body = (await res.json()) as {
      decision: { outcome: string };
      queued: boolean;
      persisted: boolean;
    };
    expect(body.decision.outcome).toBe("ESCALATE");
    expect(body.queued).toBe(false);
    expect(body.persisted).toBe(false);
    expect(insertedRows).not.toContain("gateway_decision");
  });

  it("propagates and persists toolIntent, planSummary, and toolParameters", async () => {
    const req = new Request("http://localhost:3000/api/gateway/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: "dec-decide-intent",
        artifactHash: "sha256:decide-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-1",
            revisionId: "r-1",
            artifactHash: "sha256:decide-test",
          },
        ],
        toolIntent: "Read user file",
        planSummary: "Analyze contents and print summary",
        toolParameters: { path: "/etc/passwd", format: "json" },
      }),
    });
    const res = await decidePost(req);
    expect(res.status).toBe(200);
    expect(insertedRows).toContain("gateway_decision");

    // The SQL template itself occupies index 0. Agent and session identity
    // precede the persisted intent fields in the gateway_decision insert.
    expect(lastGatewayDecisionArgs[20]).toBe("Read user file");
    expect(lastGatewayDecisionArgs[21]).toBe("Analyze contents and print summary");
    expect(lastGatewayDecisionArgs[22]).toBe(
      JSON.stringify({ path: "/etc/passwd", format: "json" }),
    );
  });

  it("merges toolIntent, planSummary, and toolParameters into raw_evidence when client provides custom rawEvidence", async () => {
    conflictDecision = false;
    const req = new Request("http://localhost:3000/api/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEMO_TOKEN}` },
      body: JSON.stringify({
        decisionId: "dec-evidence-custom-raw",
        tenantId: "22222222-2222-4222-8222-222222222222",
        workspaceId: "regular-workspace",
        environment: "production",
        runtimeTarget: { stack: "LOCAL" },
        agentId: "agent-gw-1",
        connector: "stripe",
        action: "charge",
        status: "ALLOW",
        reason: "gateway test decision",
        policyRefs: ["stripe.payment.authorize"],
        artifactHash: "sha256:gateway-test",
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: "b-gw-1",
            revisionId: "r-gw-1",
            artifactHash: "sha256:gateway-test",
          },
        ],
        toolIntent: "Read user file",
        planSummary: "Analyze contents and print summary",
        toolParameters: { path: "/etc/passwd", format: "json" },
        rawEvidence: { clientCustomField: "customVal" },
      }),
    });
    const res = await evidencePost(req);
    expect(res.status).toBe(201);
    expect(insertedRows).toContain("evidence");

    const persistedRawEvidenceStr = lastEvidenceArgs[15] as string;
    const persistedRawEvidence = JSON.parse(persistedRawEvidenceStr);
    expect(persistedRawEvidence.clientCustomField).toBe("customVal");
    expect(persistedRawEvidence.toolIntent).toBe("Read user file");
    expect(persistedRawEvidence.planSummary).toBe("Analyze contents and print summary");
    expect(persistedRawEvidence.toolParameters).toEqual({ path: "/etc/passwd", format: "json" });
  });
});
