import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildEvidenceRequest,
  findDedupTelemetry,
  makeEvidenceSqlMock,
} from "./evidence-route-test-helper";

// ── Mock external dependencies ─────────────────────────────────────────────

const ensureDemoTenantSpy = vi.fn();
const revalidatePathSpy = vi.fn();

let nextInsertResult: unknown[] = [{ decision_id: "dec-1" }];
const sqlMock = makeEvidenceSqlMock(() => nextInsertResult);

vi.mock("@/lib/db", () => ({ sql: sqlMock }));

vi.mock("@/lib/demo", () => ({
  DEMO_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  DEMO_WORKSPACE_ID: "demo-workspace",
}));

vi.mock("@/lib/repositories/seed/local-dev", () => ({ ensureDemoTenant: ensureDemoTenantSpy }));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi
    .fn()
    .mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "00000000-0000-0000-0000-000000000001",
        workspaceId: "demo-workspace",
        principalId: "svc-1",
        scopes: ["evidence:write"],
      },
    }),
  hasBearerToken: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathSpy }));

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

const route = await import("../app/api/evidence/route");

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Evidence route – dedup and idempotency (R1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDemoTenantSpy.mockResolvedValue(undefined);
    revalidatePathSpy.mockReturnValue(undefined);
    nextInsertResult = [{ decision_id: "dec-1" }]; // default: fresh insert
  });

  it("returns 201 when a new evidence record is inserted", async () => {
    nextInsertResult = [{ decision_id: "dec-1" }]; // RETURNING returns the row → fresh insert

    const res = await route.POST(buildEvidenceRequest());

    expect(res.status).toBe(201);
    const body = (await res.json()) as { evidence: unknown; deduplicated?: boolean };
    expect(body.deduplicated).toBeUndefined();
  });

  it("returns 200 with deduplicated:true when the same decision_id conflicts (hook source)", async () => {
    nextInsertResult = []; // ON CONFLICT DO NOTHING → RETURNING is empty

    const res = await route.POST(buildEvidenceRequest({}, "hook"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduplicated: boolean };
    expect(body.deduplicated).toBe(true);
  });

  it("returns 200 with deduplicated:true when the same decision_id conflicts (mcp source)", async () => {
    nextInsertResult = [];

    const res = await route.POST(buildEvidenceRequest({}, "mcp"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduplicated: boolean };
    expect(body.deduplicated).toBe(true);
  });

  it("does NOT call revalidatePath when the write is a duplicate", async () => {
    nextInsertResult = [];

    await route.POST(buildEvidenceRequest());

    expect(revalidatePathSpy).not.toHaveBeenCalled();
  });

  it("calls revalidatePath after a fresh insert", async () => {
    nextInsertResult = [{ decision_id: "dec-1" }];

    await route.POST(buildEvidenceRequest());

    expect(revalidatePathSpy).toHaveBeenCalledWith("/evidence");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/compliance");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/agents");
  });

  it("resolves source type from x-spctre-source header (mcp) and emits telemetry", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    nextInsertResult = []; // trigger dedup path so telemetry fires

    await route.POST(buildEvidenceRequest({}, "mcp"));

    const telemetryLine = findDedupTelemetry(consoleSpy);

    expect(telemetryLine).toBeDefined();
    expect(telemetryLine?.incoming_source).toBe("mcp");
    consoleSpy.mockRestore();
  });

  it("resolves source type from x-spctre-source header (hook) and emits telemetry", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    nextInsertResult = [];

    await route.POST(buildEvidenceRequest({}, "hook"));

    const telemetryLine = findDedupTelemetry(consoleSpy);

    expect(telemetryLine?.incoming_source).toBe("hook");
    consoleSpy.mockRestore();
  });

  it("falls back to hook source when x-spctre-source header is absent", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    nextInsertResult = [];

    const reqWithoutHeader = buildEvidenceRequest(
      { decisionId: "dec-1", reason: "ok", status: "ALLOW" },
      "hook",
      { includeSourceHeader: false },
    );

    await route.POST(reqWithoutHeader);

    const telemetryLine = findDedupTelemetry(consoleSpy);

    expect(telemetryLine?.incoming_source).toBe("hook");
    consoleSpy.mockRestore();
  });

  it("emits structured telemetry with decision_id and tenant_id on dedup", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    nextInsertResult = [];

    await route.POST(buildEvidenceRequest({ decisionId: "dec-telemetry-42" }));

    const telemetry = findDedupTelemetry(consoleSpy);

    expect(telemetry?.decision_id).toBe("dec-telemetry-42");
    expect(telemetry?.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(typeof telemetry?.suppressed_at).toBe("string");
    consoleSpy.mockRestore();
  });
});
