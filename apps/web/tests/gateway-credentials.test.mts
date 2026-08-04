import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Hoist mock state and sql function together
const { state, sqlMock } = vi.hoisted(() => {
  const state = {
    brokerMockRow: null as any,
    insertedGrantRow: null as any,
    escalationStatusMockRow: null as any,
    grantIssuedMock: false,
    forceGrantInsertConflict: false,
    updatedDecisionRow: null as any,
    updatedEscalationRow: null as any,
  };

  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("").replace(/\s+/g, " ").trim().toUpperCase();

    if (joined.includes("FROM GATEWAY_CREDENTIAL_BROKER")) {
      if (state.brokerMockRow) {
        return Promise.resolve([state.brokerMockRow]);
      }
      return Promise.resolve([]);
    }
    if (joined.startsWith("INSERT INTO GATEWAY_CREDENTIAL_GRANT")) {
      if (state.grantIssuedMock || state.forceGrantInsertConflict) {
        return Promise.resolve([]);
      }
      state.insertedGrantRow = {
        tenantId: args[1],
        workspaceId: args[2],
        gatewayDecisionId: args[3],
        brokerId: args[4],
        injectedParameter: args[5],
        expiresAt: args[6],
      };
      state.grantIssuedMock = true;
      return Promise.resolve([{ id: "mock-grant-uuid" }]);
    }
    if (joined.includes("FROM GATEWAY_CREDENTIAL_GRANT") && joined.includes("COUNT(")) {
      return Promise.resolve([{ count: state.grantIssuedMock ? "1" : "0" }]);
    }
    if (joined.startsWith("UPDATE GATEWAY_DECISION")) {
      state.updatedDecisionRow = {
        outcome: args[1],
        reason: args[2],
        id: args[3],
        tenantId: args[4],
      };
      return Promise.resolve([]);
    }
    if (joined.startsWith("UPDATE GATEWAY_ESCALATION_QUEUE")) {
      state.updatedEscalationRow = {
        resolutionOutcome: args[1],
        resolutionNote: args[2],
        gatewayDecisionId: args[3],
        tenantId: args[4],
        workspaceId: args[5],
      };
      return Promise.resolve([]);
    }
    if (joined.includes("FROM GATEWAY_ESCALATION_QUEUE")) {
      if (state.escalationStatusMockRow) {
        return Promise.resolve([state.escalationStatusMockRow]);
      }
      return Promise.resolve([]);
    }
    if (joined.startsWith("INSERT INTO GATEWAY_DECISION")) {
      return Promise.resolve([{ id: "gd-uuid-1" }]);
    }
    // Auth checks, workspace checks etc.
    return Promise.resolve([{ id: "row-exists", count: "0" }]);
  };

  const sqlMock = Object.assign(fn, {
    begin: vi.fn(async (callback: (tx: typeof fn) => Promise<unknown>) => callback(fn)),
  });

  return { state, sqlMock };
});

vi.mock("@/lib/db", () => ({ sql: sqlMock }));

// These cases exercise credential brokering, not policy enforcement. The sql
// mock above is a generic stub, so let the decide route see "nothing published"
// rather than a malformed bundle row.
vi.mock("@/lib/repositories/policy", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/repositories/policy")>();
  return { ...real, getLatestPublishedBundle: vi.fn().mockResolvedValue(null) };
});

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi
    .fn()
    .mockResolvedValue({
      ok: true,
      auth: {
        tenantId: "22222222-2222-4222-8222-222222222222",
        workspaceId: "regular-workspace",
        principalId: "svc-gateway-test",
        scopes: ["evidence:write", "operations:read"],
      },
    }),
  hasBearerToken: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthSession: vi.fn().mockRejectedValue(new Error("No session")),
}));

vi.mock("@/lib/workspace/scope", () => ({
  getActiveScope: vi.fn().mockRejectedValue(new Error("No scope")),
}));

vi.mock("@/lib/repositories/shared/database", () => ({ isDatabaseConfigured: () => true }));

vi.mock("@/lib/platform/config", () => ({
  isGatewayEnabled: () => true,
  gatewayMode: () => "enforce",
  evidenceIngestUrl: () => "",
}));

// We import after mocks
import { POST as handlePostDecide } from "../app/api/gateway/decide/route";
import { GET as handleGetStatus } from "../app/api/gateway/escalations/status/route";
import { findCredentialBroker, brokerCredential } from "../lib/repositories/gateway";

describe("JIT Ephemeral Credentials Brokering", () => {
  beforeEach(() => {
    state.brokerMockRow = null;
    state.insertedGrantRow = null;
    state.escalationStatusMockRow = null;
    state.grantIssuedMock = false;
    state.forceGrantInsertConflict = false;
    state.updatedDecisionRow = null;
    state.updatedEscalationRow = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Repository", () => {
    it("finds credential broker config", async () => {
      state.brokerMockRow = {
        id: "broker-1",
        credential_type: "STRIPE_RESTRICTED",
        injected_parameter: "auth.token",
        broker_config: {},
      };

      const broker = await findCredentialBroker({
        tenantId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "w-1",
        connector: "stripe",
        action: "charge",
      });

      expect(broker).not.toBeNull();
      expect(broker?.id).toBe("broker-1");
      expect(broker?.credentialType).toBe("STRIPE_RESTRICTED");
      expect(broker?.injectedParameter).toBe("auth.token");
    });

    it("brokers STRIPE_RESTRICTED credentials dynamically", async () => {
      const broker = {
        id: "broker-2",
        credentialType: "STRIPE_RESTRICTED" as const,
        injectedParameter: "apiKey",
        brokerConfig: {},
      };

      const result = await brokerCredential(broker, {
        tenantId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "w-1",
        gatewayDecisionId: "gd-2",
      });

      expect(result.status).toBe("granted");
      if (result.status === "granted") {
        expect(result.grant.credentialValue).toContain("rk_test_jit_");
      }
      expect(state.insertedGrantRow).not.toBeNull();
      expect(state.insertedGrantRow.brokerId).toBe("broker-2");
    });

    it("brokers MOCK credentials dynamically", async () => {
      const broker = {
        id: "broker-3",
        credentialType: "MOCK" as const,
        injectedParameter: "token",
        brokerConfig: {},
      };

      const result = await brokerCredential(broker, {
        tenantId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "w-1",
        gatewayDecisionId: "gd-3",
      });

      expect(result.status).toBe("granted");
      if (result.status === "granted") {
        expect(result.grant.credentialValue).toContain("ephemeral-mock-token-");
      }
    });

    it("returns already_issued when a grant has already been issued (concurrency conflict)", async () => {
      const broker = {
        id: "broker-4",
        credentialType: "MOCK" as const,
        injectedParameter: "token",
        brokerConfig: {},
      };

      // Mark grant as already issued
      state.grantIssuedMock = true;

      const result = await brokerCredential(broker, {
        tenantId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "w-1",
        gatewayDecisionId: "gd-4",
      });

      expect(result.status).toBe("already_issued");
    });
  });

  describe("API Decide Route", () => {
    it("returns credential grant on immediate PROCEED", async () => {
      state.brokerMockRow = {
        id: "broker-1",
        credential_type: "MOCK",
        injected_parameter: "apiKey",
        broker_config: {},
      };

      const requestBody = {
        decisionId: "dec-decide-1",
        artifactHash: "hash-123",
        policyContext: [
          { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "hash-123" },
        ],
        consequence: "LOW",
        connector: "stripe",
        action: "charge",
      };

      const req = new Request("http://localhost:3000/api/gateway/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer some-token" },
        body: JSON.stringify(requestBody),
      });

      const resp = await handlePostDecide(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.decision.outcome).toBe("PROCEED");
      expect(data.decision.credentialGrant).toBeDefined();
      expect(data.decision.credentialGrant.credentialType).toBe("MOCK");
      expect(data.decision.credentialGrant.credentialValue).toContain("ephemeral-mock-token-");
    });

    it("aborts decision if broker is matched but brokering fails", async () => {
      state.brokerMockRow = {
        id: "broker-1",
        credential_type: "INVALID_TYPE" as any, // will cause brokerCredential to return { status: "error" }
        injected_parameter: "apiKey",
        broker_config: {},
      };

      const requestBody = {
        decisionId: "dec-decide-2",
        artifactHash: "hash-123",
        policyContext: [
          { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "hash-123" },
        ],
        consequence: "LOW",
        connector: "stripe",
        action: "charge",
      };

      const req = new Request("http://localhost:3000/api/gateway/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer some-token" },
        body: JSON.stringify(requestBody),
      });

      const resp = await handlePostDecide(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.decision.outcome).toBe("ABORT");
      expect(data.decision.reason).toBe("Credential brokering failed.");

      expect(state.updatedDecisionRow).not.toBeNull();
      expect(state.updatedDecisionRow.outcome).toBe("ABORT");
      expect(state.updatedDecisionRow.reason).toBe("Credential brokering failed.");
    });

    it("aborts this response without persistence mutation if a concurrent request already issued the grant", async () => {
      state.brokerMockRow = {
        id: "broker-1",
        credential_type: "MOCK",
        injected_parameter: "apiKey",
        broker_config: {},
      };
      state.forceGrantInsertConflict = true;

      const requestBody = {
        decisionId: "dec-decide-concurrent",
        artifactHash: "hash-123",
        policyContext: [
          { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "hash-123" },
        ],
        consequence: "LOW",
        connector: "stripe",
        action: "charge",
      };

      const req = new Request("http://localhost:3000/api/gateway/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer some-token" },
        body: JSON.stringify(requestBody),
      });

      const resp = await handlePostDecide(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.decision.outcome).toBe("ABORT");
      expect(data.decision.reason).toBe("Credential already issued by a concurrent request.");
      expect(data.decision.credentialGrant).toBeUndefined();
      expect(state.updatedDecisionRow).toBeNull();
    });
  });

  describe("API Status Route", () => {
    it("returns credential grant when escalation is resolved to PROCEED", async () => {
      state.escalationStatusMockRow = {
        decision_id: "dec-status-1",
        status: "RESOLVED",
        resolution_outcome: "PROCEED",
        resolution_note: "Reviewer OK",
        agent_guidance: "Use carefully",
        sla_due_at: new Date(),
        resolved_at: new Date(),
        gateway_decision_id: "gd-status-1",
        connector: "stripe",
        action: "charge",
        tool_parameters: { kind: "article", title: "Approved brief" },
      };

      state.brokerMockRow = {
        id: "broker-status-1",
        credential_type: "MOCK",
        injected_parameter: "stripeKey",
        broker_config: {},
      };

      const req = new Request(
        "http://localhost:3000/api/gateway/escalations/status?decisionId=dec-status-1",
        { method: "GET", headers: { Authorization: "Bearer some-token" } },
      );

      const resp = await handleGetStatus(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.status).toBe("RESOLVED");
      expect(data.resolutionOutcome).toBe("PROCEED");
      expect(data.credentialGrant).toBeDefined();
      expect(data.credentialGrant.credentialType).toBe("MOCK");
      expect(data.credentialGrant.credentialValue).toContain("ephemeral-mock-token-");
      expect(data.approvedToolParameters).toEqual({ kind: "article", title: "Approved brief" });
    });

    it("aborts status outcome if broker is matched but brokering fails", async () => {
      state.escalationStatusMockRow = {
        decision_id: "dec-status-2",
        status: "RESOLVED",
        resolution_outcome: "PROCEED",
        resolution_note: "Reviewer OK",
        agent_guidance: "Use carefully",
        sla_due_at: new Date(),
        resolved_at: new Date(),
        gateway_decision_id: "gd-status-2",
        connector: "stripe",
        action: "charge",
        tool_parameters: { kind: "article", title: "Must stay hidden" },
      };

      state.brokerMockRow = {
        id: "broker-status-2",
        credential_type: "INVALID",
        injected_parameter: "stripeKey",
        broker_config: {},
      };

      const req = new Request(
        "http://localhost:3000/api/gateway/escalations/status?decisionId=dec-status-2",
        { method: "GET", headers: { Authorization: "Bearer some-token" } },
      );

      const resp = await handleGetStatus(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.status).toBe("RESOLVED");
      expect(data.resolutionOutcome).toBe("ABORT");
      expect(data.resolutionNote).toBe("Credential brokering failed.");
      expect(data.approvedToolParameters).toBeUndefined();

      expect(state.updatedEscalationRow).not.toBeNull();
      expect(state.updatedEscalationRow.resolutionOutcome).toBe("ABORT");
      expect(state.updatedEscalationRow.resolutionNote).toBe("Credential brokering failed.");
    });

    it("aborts this status response but does not persist if a credential was already issued", async () => {
      state.escalationStatusMockRow = {
        decision_id: "dec-status-3",
        status: "RESOLVED",
        resolution_outcome: "PROCEED",
        resolution_note: "Reviewer OK",
        agent_guidance: "Use carefully",
        sla_due_at: new Date(),
        resolved_at: new Date(),
        gateway_decision_id: "gd-status-3",
        connector: "stripe",
        action: "charge",
      };

      state.brokerMockRow = {
        id: "broker-status-3",
        credential_type: "MOCK",
        injected_parameter: "stripeKey",
        broker_config: {},
      };

      state.grantIssuedMock = true;

      const req = new Request(
        "http://localhost:3000/api/gateway/escalations/status?decisionId=dec-status-3",
        { method: "GET", headers: { Authorization: "Bearer some-token" } },
      );

      const resp = await handleGetStatus(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.status).toBe("RESOLVED");
      expect(data.resolutionOutcome).toBe("ABORT");
      expect(data.resolutionNote).toBe("Credential already issued by a concurrent request.");
      expect(data.credentialGrant).toBeUndefined();
      expect(state.updatedEscalationRow).toBeNull();
    });

    it("aborts this status response without persistence mutation if insert loses a concurrent race", async () => {
      state.escalationStatusMockRow = {
        decision_id: "dec-status-4",
        status: "RESOLVED",
        resolution_outcome: "PROCEED",
        resolution_note: "Reviewer OK",
        agent_guidance: "Use carefully",
        sla_due_at: new Date(),
        resolved_at: new Date(),
        gateway_decision_id: "gd-status-4",
        connector: "stripe",
        action: "charge",
      };

      state.brokerMockRow = {
        id: "broker-status-4",
        credential_type: "MOCK",
        injected_parameter: "stripeKey",
        broker_config: {},
      };
      state.forceGrantInsertConflict = true;

      const req = new Request(
        "http://localhost:3000/api/gateway/escalations/status?decisionId=dec-status-4",
        { method: "GET", headers: { Authorization: "Bearer some-token" } },
      );

      const resp = await handleGetStatus(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.status).toBe("RESOLVED");
      expect(data.resolutionOutcome).toBe("ABORT");
      expect(data.resolutionNote).toBe("Credential already issued by a concurrent request.");
      expect(data.credentialGrant).toBeUndefined();
      expect(state.updatedEscalationRow).toBeNull();
    });
  });

  describe("API Decide Route Replays", () => {
    it("aborts decision and fails closed if credential grant has already been issued", async () => {
      state.grantIssuedMock = true;

      const requestBody = {
        decisionId: "dec-decide-3",
        artifactHash: "hash-123",
        policyContext: [
          { scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "hash-123" },
        ],
        consequence: "LOW",
        connector: "stripe",
        action: "charge",
      };

      const req = new Request("http://localhost:3000/api/gateway/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer some-token" },
        body: JSON.stringify(requestBody),
      });

      const resp = await handlePostDecide(req);
      expect(resp.status).toBe(200);

      const data = await resp.json();
      expect(data.decision.outcome).toBe("ABORT");
      expect(data.decision.reason).toBe("Credential grant already issued for this decision.");
      expect(data.decision.credentialGrant).toBeUndefined();
    });
  });
});
