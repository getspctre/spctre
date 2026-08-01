import { beforeEach, describe, expect, it, vi } from "vitest";

const seedState = vi.hoisted(() => {
  const state: {
    ruleRows: Array<Record<string, unknown>>;
    revisionDocuments: Array<Record<string, unknown>>;
    publishRows: Array<{ environment: unknown; runtimeAdapter: unknown; publishedBy: unknown }>;
    approvalRows: Array<{ reviewerId: unknown; reviewerRole: unknown; status: unknown }>;
    branchId: string | null;
    activeRevisionId: unknown;
    artifactHash: unknown;
    
    // Phase 2 High-Fidelity Seeding collections
    calibrationPolicies: Array<Record<string, unknown>>;
    budgetEvents: Array<Record<string, unknown>>;
    trustScoreEvents: Array<Record<string, unknown>>;
    gatewayDecisions: Array<Record<string, unknown>>;
    gatewayEscalations: Array<Record<string, unknown>>;
    runtimeEvidenceEvents: Array<Record<string, unknown>>;
    runtimeEvidenceKeys: Array<Record<string, unknown>>;
    operationsLogs: Array<{
      tenantId: unknown;
      workspaceId: unknown;
      eventType: unknown;
      actorId: unknown;
      contentHash: string;
      prevHash: string | null;
    }>;

    tx: ReturnType<typeof vi.fn> & { json: (value: unknown) => string };
    sql: ReturnType<typeof vi.fn> & {
      begin: ReturnType<typeof vi.fn>;
      counts: { connecting: number; idle: number; active: number; waiting: number };
      json: (value: unknown) => string;
    };
  } = {
    ruleRows: [],
    revisionDocuments: [],
    publishRows: [],
    approvalRows: [],
    branchId: null,
    activeRevisionId: null,
    artifactHash: null,
    
    calibrationPolicies: [],
    budgetEvents: [],
    trustScoreEvents: [],
    gatewayDecisions: [],
    gatewayEscalations: [],
    runtimeEvidenceEvents: [],
    runtimeEvidenceKeys: [],
    operationsLogs: [],
    // Per-tenant operations-log chain head (agt_operations_log_chain_head).
    chainHeads: new Map<string, string | null>(),

    // Mirrors postgres' sql.json()/tx.json(): serializes to the jsonb-bound
    // payload (a string param, not a JS array).
    tx: Object.assign(vi.fn(), { json: (value: unknown) => JSON.stringify(value) }),
    sql: Object.assign(vi.fn(), {
      begin: vi.fn(),
      counts: { connecting: 0, idle: 1, active: 0, waiting: 0 },
      json: (value: unknown) => JSON.stringify(value),
    }),
  };

  function handleQuery(query: string, values: unknown[]) {
    // 1. SELECT pb.id AS branch_id or general active revision checks
    if (query.includes("SELECT pb.id AS branch_id") || query.includes("SELECT pb.id, pb.active_revision_id")) {
      return Promise.resolve(
        state.branchId && state.activeRevisionId
          ? [{ branch_id: state.branchId, active_revision_id: state.activeRevisionId, artifact_hash: state.artifactHash, id: state.branchId, active_revision_id: state.activeRevisionId }]
          : []
      );
    }
    
    // 2. INSERT INTO policy_branch
    if (query.includes("INSERT INTO policy_branch")) {
      state.branchId = "branch-spctre-agent";
      return Promise.resolve([{ id: state.branchId }]);
    }

    // 3. INSERT INTO policy_revision
    if (query.includes("INSERT INTO policy_revision")) {
      state.activeRevisionId = values[0];
      state.artifactHash = values.find((value) => typeof value === "string" && value.startsWith("sha256:"));
      const sourceDocumentValue = values.find((value) => {
        if (typeof value !== "string") return false;
        try {
          return Boolean(JSON.parse(value).metadata);
        } catch {
          return false;
        }
      });
      if (typeof sourceDocumentValue === "string") {
        state.revisionDocuments.push(JSON.parse(sourceDocumentValue));
      }
      return Promise.resolve([]);
    }

    // 4. INSERT INTO policy_approval
    if (query.includes("INSERT INTO policy_approval")) {
      state.approvalRows.push(
        { reviewerId: values[4], reviewerRole: "Security", status: "APPROVED" },
        { reviewerId: values[9], reviewerRole: "Platform", status: "APPROVED" }
      );
      return Promise.resolve([]);
    }

    // 5. INSERT INTO policy_publish
    if (query.includes("INSERT INTO policy_publish")) {
      const environment = values.includes("production") ? "production" : values.includes("development") ? "development" : undefined;
      const runtimeAdapter = values.includes("spctre-control-plane")
        ? "spctre-control-plane"
        : values.includes("spctre-local-dev")
          ? "spctre-local-dev"
          : undefined;
      const publishedBy = values.includes("seed:local-dev")
        ? "seed:local-dev"
        : values.find((value) => value === "00000000-0000-0000-0000-000000000011");
      state.publishRows.push({ environment, runtimeAdapter, publishedBy });
      return Promise.resolve([]);
    }

    // 6. SELECT COUNT(*)::text AS count
    if (query.includes("SELECT COUNT(*)::text AS count")) {
      return Promise.resolve([{ count: state.activeRevisionId ? "1" : "0" }]);
    }

    // Economic deletes & inserts
    if (query.includes("DELETE FROM economic_usage_event") || query.includes("DELETE FROM economic_budget_policy")) {
      return Promise.resolve([]);
    }
    if (query.includes("INSERT INTO economic_budget_policy") || query.includes("INSERT INTO economic_usage_event")) {
      return Promise.resolve([]);
    }

    // 7. Trust Calibration Policy seeding
    if (query.includes("INSERT INTO trust_calibration_policy")) {
      for (let i = 0; i < values.length; i += 2) {
        state.calibrationPolicies.push({
          tenant_id: values[i],
          workspace_id: values[i + 1],
        });
      }
      return Promise.resolve([]);
    }

    // 8. Context Budget Event seeding
    if (query.includes("INSERT INTO context_budget_event")) {
      for (let i = 0; i < values.length; i += 2) {
        state.budgetEvents.push({
          tenant_id: values[i],
          workspace_id: values[i + 1],
        });
      }
      return Promise.resolve([]);
    }

    // 9. Trust Score History seeding
    if (query.includes("INSERT INTO agt_trust_score_event")) {
      for (let i = 0; i < values.length; i += 2) {
        state.trustScoreEvents.push({
          tenant_id: values[i],
          workspace_id: values[i + 1],
        });
      }
      return Promise.resolve([]);
    }

    // 10. Gateway Decision seeding with RETURNING support
    if (query.includes("INSERT INTO gateway_decision")) {
      const decisions = [
        { id: "dec-uuid-001", decision_id: "dec-stripe-001" },
        { id: "dec-uuid-002", decision_id: "dec-stripe-002" },
        { id: "dec-uuid-003", decision_id: "dec-stripe-003" },
      ];
      state.gatewayDecisions.push(...decisions);
      return Promise.resolve(decisions);
    }

    // 11. Gateway Escalation seeding
    if (query.includes("INSERT INTO gateway_escalation_queue")) {
      for (let i = 0; i < values.length; i += 5) {
        state.gatewayEscalations.push({
          tenant_id: values[i],
          workspace_id: values[i + 1],
          gateway_decision_id: values[i + 2],
          decision_id: `dec-stripe-00${Math.floor(i / 5) + 1}`,
        });
      }
      return Promise.resolve([]);
    }

    // 12. Partition helper
    if (query.includes("spctre_ensure_runtime_evidence_partitions")) {
      return Promise.resolve([]);
    }

    // 13. Runtime Evidence Event Key seeding. The production writer claims the
    // unique decision key before inserting its event, then attaches the event
    // within the same transaction.
    if (query.includes("INSERT INTO runtime_evidence_event_key")) {
      const key = {
        tenant_id: values[0],
        decision_id: values[1],
        evidence_event_id: undefined,
      };
      state.runtimeEvidenceKeys.push(key);
      return Promise.resolve(query.includes("RETURNING decision_id") ? [key] : []);
    }

    if (query.includes("UPDATE runtime_evidence_event_key")) {
      const key = state.runtimeEvidenceKeys.find(
        (item) => item.tenant_id === values[2] && item.decision_id === values[3]
      );
      if (key) key.evidence_event_id = values[0];
      return Promise.resolve([]);
    }

    // 14. Runtime Evidence Event seeding
    if (query.includes("INSERT INTO runtime_evidence_event") && !query.includes("INSERT INTO runtime_evidence_event_key")) {
      state.runtimeEvidenceEvents.push({
        id: values[0],
        decision_id: values[1],
        tenant_id: values[2],
        workspace_id: values[3],
        agent_id: values[4],
        connector: values[5],
        action: values[6],
        status: values[7],
        reason: values[8],
      });
      return Promise.resolve([]);
    }

    // 15. Operations Log prev_hash lookup
    if (query.includes("SELECT content_hash") && query.includes("FROM agt_operations_log")) {
      const lastEntry = state.operationsLogs[state.operationsLogs.length - 1];
      return Promise.resolve(lastEntry ? [{ content_hash: lastEntry.contentHash }] : []);
    }

    // 15b. Operations-log chain head (must precede the ops-log INSERT branch —
    // "agt_operations_log_chain_head" contains "agt_operations_log").
    if (query.includes("agt_operations_log_chain_head")) {
      if (query.includes("INSERT")) {
        const tenantId = values[0] as string;
        return Promise.resolve([{ last_hash: state.chainHeads.get(tenantId) ?? null }]);
      }
      if (query.includes("UPDATE")) {
        const newHash = (values[0] ?? null) as string | null;
        const tenantId = values[1] as string;
        state.chainHeads.set(tenantId, newHash);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }

    // 16. Operations Log append
    if (query.includes("INSERT INTO agt_operations_log")) {
      state.operationsLogs.push({
        tenantId: values[0],
        workspaceId: values[1],
        eventType: values[2],
        actorId: values[5],
        contentHash: values[7] as string,
        prevHash: (values[8] ?? null) as string | null,
      });
      return Promise.resolve([]);
    }

    // 17. Tenant context RLS set config
    if (query.includes("set_config('app.current_tenant_id'")) {
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  }

  state.tx.mockImplementation((first: unknown, ...values: unknown[]) => {
    if (Array.isArray(first) && typeof first[0] === "object") {
      state.ruleRows = first as Array<Record<string, unknown>>;
      return { rows: first, columns: values };
    }

    const query = Array.isArray(first) ? first.join(" ") : "";
    return handleQuery(query, values);
  });

  state.sql.mockImplementation((first: unknown, ...values: unknown[]) => {
    const query = Array.isArray(first) ? first.join(" ") : "";
    return handleQuery(query, values);
  });

  state.sql.begin.mockImplementation((callback: (tx: typeof state.tx) => Promise<unknown>) =>
    callback(state.tx)
  );

  return state;
});

vi.mock("postgres", () => ({
  default: vi.fn(() => seedState.sql),
}));

vi.mock("@spctre/platform", () => ({
  registerDbPoolMetrics: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  computeShortHash: (input: string) => `sha256:${input.slice(0, 16)}`,
}));

process.env.DATABASE_URL = "postgres://spctre-local-dev";

const { canBootstrapDemoTenant, ensureDemoTenant } = await import("../lib/repositories/seed/local-dev");

describe("local dev seeded workspace", () => {
  beforeEach(() => {
    seedState.ruleRows.length = 0;
    seedState.revisionDocuments.length = 0;
    seedState.publishRows.length = 0;
    seedState.approvalRows.length = 0;
    seedState.branchId = null;
    seedState.activeRevisionId = null;
    seedState.artifactHash = null;

    // Resetting new Phase 2 collections in-place to avoid closure references
    seedState.calibrationPolicies.length = 0;
    seedState.budgetEvents.length = 0;
    seedState.trustScoreEvents.length = 0;
    seedState.gatewayDecisions.length = 0;
    seedState.gatewayEscalations.length = 0;
    seedState.runtimeEvidenceEvents.length = 0;
    seedState.runtimeEvidenceKeys.length = 0;
    seedState.operationsLogs.length = 0;
    seedState.chainHeads.clear();

    seedState.sql.mockClear();
    seedState.tx.mockClear();
    seedState.sql.begin.mockClear();
  });

  it("requires an explicit opt-in before seeding a production deployment", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDemoEnabled = process.env.SPCTRE_ENABLE_DEMO_TENANT;
    process.env.NODE_ENV = "production";
    delete process.env.SPCTRE_ENABLE_DEMO_TENANT;

    expect(canBootstrapDemoTenant()).toBe(false);

    process.env.SPCTRE_ENABLE_DEMO_TENANT = "true";
    expect(canBootstrapDemoTenant()).toBe(true);

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDemoEnabled === undefined) delete process.env.SPCTRE_ENABLE_DEMO_TENANT;
    else process.env.SPCTRE_ENABLE_DEMO_TENANT = previousDemoEnabled;
  });

  it("installs, approves, and publishes the Spctre embedded-agent governance pack into default and production-pilot targets", async () => {
    await ensureDemoTenant();

    expect(seedState.ruleRows).toHaveLength(8);
    expect(seedState.ruleRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stable_rule_id: "spctre-agent.triage.require_agent_triage_log",
          connectors: ["spctre-agent"],
          source_path: "packs/spctre-agent-governance-v1.json",
        }),
        expect.objectContaining({
          stable_rule_id: "spctre-agent.escalations.block_agent_resolution",
          effect: "DENY",
          connectors: ["spctre-agent"],
        }),
        expect.objectContaining({
          stable_rule_id: "spctre-agent.policy.block_agent_mutation",
          effect: "DENY",
          connectors: ["spctre-agent"],
        }),
      ])
    );
    expect(seedState.revisionDocuments[0]?.metadata).toEqual(
      expect.objectContaining({
        connector: "spctre-agent",
        version: "1.0.0",
      })
    );
    expect(seedState.approvalRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reviewerId: "00000000-0000-0000-0000-000000000011",
          reviewerRole: "Security",
          status: "APPROVED",
        }),
        expect.objectContaining({
          reviewerId: "00000000-0000-0000-0000-000000000012",
          reviewerRole: "Platform",
          status: "APPROVED",
        }),
      ])
    );
    expect(seedState.publishRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        environment: "development",
        runtimeAdapter: "spctre-local-dev",
        publishedBy: "seed:local-dev",
      }),
      expect.objectContaining({
        environment: "production",
        runtimeAdapter: "spctre-control-plane",
        publishedBy: "00000000-0000-0000-0000-000000000011",
      }),
    ]));
  });

  it("seeds high-fidelity telemetry, trust events, budget context, and cryptographic operations logs for the demo tenant", async () => {
    await ensureDemoTenant();

    const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000001";
    const DEMO_WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";

    // 1. Trust Calibration Policies
    expect(seedState.calibrationPolicies).toHaveLength(3);
    expect(seedState.calibrationPolicies[0]).toEqual(
      expect.objectContaining({
        tenant_id: DEMO_TENANT_ID,
        workspace_id: DEMO_WORKSPACE_ID,
      })
    );

    // 2. Context Budget Events
    expect(seedState.budgetEvents).toHaveLength(4);
    expect(seedState.budgetEvents[0]).toEqual(
      expect.objectContaining({
        tenant_id: DEMO_TENANT_ID,
        workspace_id: DEMO_WORKSPACE_ID,
      })
    );

    // 3. Trust Score Events
    expect(seedState.trustScoreEvents).toHaveLength(11);
    expect(seedState.trustScoreEvents[0]).toEqual(
      expect.objectContaining({
        tenant_id: DEMO_TENANT_ID,
        workspace_id: DEMO_WORKSPACE_ID,
      })
    );

    // 4. Gateway Decisions and Escalations
    expect(seedState.gatewayDecisions).toHaveLength(3);
    expect(seedState.gatewayEscalations).toHaveLength(3);
    expect(seedState.gatewayEscalations[0]).toEqual(
      expect.objectContaining({
        tenant_id: DEMO_TENANT_ID,
        workspace_id: DEMO_WORKSPACE_ID,
      })
    );

    // 5. Runtime Evidence Events and Keys
    expect(seedState.runtimeEvidenceEvents).toHaveLength(20);
    expect(seedState.runtimeEvidenceKeys).toHaveLength(20);
    expect(seedState.runtimeEvidenceEvents[0]).toEqual(
      expect.objectContaining({
        tenant_id: DEMO_TENANT_ID,
        workspace_id: DEMO_WORKSPACE_ID,
      })
    );

    // 6. The retired advisor surface no longer seeds synthetic recommendation
    // records. Operations logs are populated only by actual governed activity.
    expect(seedState.operationsLogs).toEqual([]);
  });
});
