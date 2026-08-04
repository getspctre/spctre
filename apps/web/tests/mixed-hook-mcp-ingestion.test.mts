/**
 * R4 Integration matrix: mixed hook+MCP ingestion and source classification.
 * SSE session lifecycle contracts moved to packages/mcp-server/tests/token.test.ts.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildEvidenceRequest, findDedupTelemetry, makeEvidenceSqlMock } from "./evidence-route-test-helper";

// ── top-level imports (must be outside describe blocks) ───────────────────────

const { shouldBlockDecision } = await import("../../../packages/cli/src/pretooluse.ts");

// ── Mock db + policy-schema so evidence route is importable without Postgres ──

// Tracks whether the simulated row already exists (conflict) for the current test.
let simulateConflict = false;

const sqlMock = makeEvidenceSqlMock(() => simulateConflict ? [] : [{ decision_id: "dec-1" }]);

vi.mock("@/lib/db", () => ({
  sql: sqlMock,
}));

vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  DEMO_WORKSPACE_ID: "demo-workspace"
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({
  ensureDemoTenant: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi.fn().mockResolvedValue({
    ok: true,
    auth: { tenantId: "00000000-0000-0000-0000-000000000001", workspaceId: "demo-workspace", principalId: "svc-1", scopes: ["evidence:write"] },
  }),
  hasBearerToken: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@spctre/policy-schema", async (importOriginal) => {
  const real = await importOriginal<typeof import("@spctre/policy-schema")>();
  return {
    ...real,
    ingestAgtRuntimeDecision: (input: Record<string, unknown>) => ({
      decisionId: input.decisionId,
      tenantId: input.tenantId ?? "00000000-0000-0000-0000-000000000001",
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
    }),
  };
});

const { POST } = await import("../app/api/evidence/route");

// ── Shared fixture ────────────────────────────────────────────────────────────

function buildRequest(decisionId: string, source: "mcp" | "hook"): Request {
  return buildEvidenceRequest({ action: "push", decisionId, latencyMs: 10 }, source);
}

// ── Mixed hook + MCP ingestion tests ─────────────────────────────────────────

describe("Mixed hook+MCP ingestion (R4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simulateConflict = false;
  });

  it("hook write followed by MCP write for same decision_id is suppressed (first write wins)", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First call: hook write, no conflict yet.
    const hookRes = await POST(buildRequest("dec-shared-1", "hook"));
    expect(hookRes.status).toBe(201);

    // Simulate row now exists → next INSERT triggers conflict.
    simulateConflict = true;

    // Second call: MCP tries same decision_id → conflict → dedup.
    const mcpRes = await POST(buildRequest("dec-shared-1", "mcp"));
    expect(mcpRes.status).toBe(200);

    const mcpBody = await mcpRes.json() as { deduplicated: boolean };
    expect(mcpBody.deduplicated).toBe(true);

    // Suppressed event records MCP as the incoming source.
    const telemetry = findDedupTelemetry(consoleSpy);

    expect(telemetry?.decision_id).toBe("dec-shared-1");
    expect(telemetry?.incoming_source).toBe("mcp");
    consoleSpy.mockRestore();
  });

  it("MCP write followed by hook write for same decision_id is suppressed", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mcpRes = await POST(buildRequest("dec-shared-2", "mcp"));
    expect(mcpRes.status).toBe(201);

    simulateConflict = true;

    const hookRes = await POST(buildRequest("dec-shared-2", "hook"));
    expect(hookRes.status).toBe(200);

    const hookBody = await hookRes.json() as { deduplicated: boolean };
    expect(hookBody.deduplicated).toBe(true);

    const telemetry = findDedupTelemetry(consoleSpy);

    expect(telemetry?.incoming_source).toBe("hook");
    consoleSpy.mockRestore();
  });

  it("distinct decision_ids from hook and MCP are both inserted without dedup", async () => {
    const hookRes = await POST(buildRequest("dec-hook-only", "hook"));
    expect(hookRes.status).toBe(201);

    // Different decision_id → no conflict (simulateConflict stays false).
    const mcpRes = await POST(buildRequest("dec-mcp-only", "mcp"));
    expect(mcpRes.status).toBe(201);
  });
});

// ── Source classification tests ───────────────────────────────────────────────

describe("Source classification via x-spctre-source header (R4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simulateConflict = true; // trigger dedup path so telemetry fires for all these tests
  });

  it("resolves sourceType=mcp from body when header is absent", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = buildEvidenceRequest(
      {
        decisionId: "dec-body-mcp",
        sourceType: "mcp",
        connector: "stripe",
        action: "charge",
        reason: "ok",
      },
      "mcp",
      { includeSourceHeader: false }
    );

    await POST(req);

    const telemetry = findDedupTelemetry(consoleSpy);

    expect(telemetry?.incoming_source).toBe("mcp");
    consoleSpy.mockRestore();
  });

  it("header takes precedence over body sourceType when both are present", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const req = buildEvidenceRequest(
      {
        decisionId: "dec-header-wins",
        sourceType: "mcp",
        action: "execute",
        reason: "ok",
      },
      "hook"
    );

    await POST(req);

    const telemetry = findDedupTelemetry(consoleSpy);

    expect(telemetry?.incoming_source).toBe("hook");
    consoleSpy.mockRestore();
  });
});

// ── Hook blocking semantics (MCP tool calls governed by enforce mode) ─────────

describe("Hook blocking semantics for MCP tool calls (R4)", () => {
  it("enforce+DENY blocks MCP tool execution", () => {
    expect(shouldBlockDecision("enforce", "DENY")).toBe(true);
  });

  it("observe+DENY does not block — observe mode logs only", () => {
    expect(shouldBlockDecision("observe", "DENY")).toBe(false);
  });

  it("enforce+WARN does not block — warn does not halt execution", () => {
    expect(shouldBlockDecision("enforce", "WARN")).toBe(false);
  });

  it("enforce+ALLOW does not block", () => {
    expect(shouldBlockDecision("enforce", "ALLOW")).toBe(false);
  });
});
