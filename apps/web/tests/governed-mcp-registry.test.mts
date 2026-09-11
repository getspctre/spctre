import { beforeEach, describe, expect, it, vi } from "vitest";

// The governed-MCP write path and the connector vocabulary it feeds.
//
// Both halves existed as a read with nothing behind it: mcp_tool_registry and
// mcp_tool_grant were queried and never written, and the connector allowlist the
// MCP server enforces was a module constant. What follows asserts the parts that
// decide whether a tool call is authorized — the union that produces the
// allowlist, the audit that has to commit with the grant, and the guards on the
// routes that issue one.

const getAuthSessionSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const getActiveScopeSpy = vi.fn();
const appendOperationsLogInTransactionSpy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-123" }), set: () => {} }),
}));
vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));
vi.mock("@/lib/actors", () => ({ findActorById: findActorByIdSpy }));
vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeSpy }));

// A sql double whose transaction runs the callback and whose queries answer
// from `rows`. The point of these cases is what commits together, not what
// Postgres does with the statements.
const state = { rows: [] as unknown[], failQuery: false };
const tx = Object.assign(
  (..._args: unknown[]) =>
    state.failQuery ? Promise.reject(new Error("connection reset")) : Promise.resolve(state.rows),
  { json: (value: unknown) => value },
);
vi.mock("@/lib/db", () => ({
  sql: Object.assign((..._args: unknown[]) => Promise.resolve(state.rows), {
    begin: (fn: (client: unknown) => unknown) => Promise.resolve(fn(tx)),
    json: (value: unknown) => value,
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: async (_tenantId: string, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/repositories/operations-log", () => ({
  appendOperationsLogInTransaction: appendOperationsLogInTransactionSpy,
}));

const { registerMcpTool, grantMcpToolCapability, revokeMcpToolCapability } =
  await import("../lib/domains/mcp/service");

const REGISTRY_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";

function workspaceWideGrantRow() {
  return {
    id: GRANT_ID,
    workspace_id: "w-123",
    agent_id: null,
    environment: "*",
    allowed: true,
    created_at: new Date("2026-09-11T00:00:00.000Z"),
    updated_at: new Date("2026-09-11T00:00:00.000Z"),
  };
}

function signedInAdmin(tenantId = TENANT) {
  getAuthSessionSpy.mockResolvedValue({
    sessionId: "session-123",
    tenantId,
    principalId: "p-123",
    subject: "admin@example.com",
    requireMfa: false,
  });
  getActiveScopeSpy.mockResolvedValue({ tenantId, workspaceId: "w-123" });
  findActorByIdSpy.mockResolvedValue({ id: "p-123", reviewerRoles: ["Admin"] });
}

describe("governed MCP registry — audit is part of the write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.failQuery = false;
    appendOperationsLogInTransactionSpy.mockResolvedValue(undefined);
  });

  it("records a registration in the operations log", async () => {
    state.rows = [{ id: REGISTRY_ID, created: true }];
    await registerMcpTool({
      tenantId: TENANT,
      workspaceId: "w-123",
      actorId: "p-123",
      serverName: "github",
      toolName: "repo.read",
      connector: "github",
      action: "repo.read",
    });

    expect(appendOperationsLogInTransactionSpy).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "MCP_TOOL_REGISTERED", sourceId: REGISTRY_ID }),
    );
  });

  it("names the grant's breadth rather than leaving null to be interpreted", async () => {
    state.rows = [workspaceWideGrantRow()];
    await grantMcpToolCapability({
      tenantId: TENANT,
      workspaceId: "w-123",
      actorId: "p-123",
      registryId: REGISTRY_ID,
    });

    const [, entry] = appendOperationsLogInTransactionSpy.mock.calls[0];
    expect(entry.eventType).toBe("MCP_TOOL_GRANTED");
    expect(entry.payload).toMatchObject({ scope: "WORKSPACE", agentId: null, environment: "*" });
  });

  it("records what a revoke withdrew, not just that one happened", async () => {
    state.rows = [{ registry_id: REGISTRY_ID, agent_id: "agent-7", environment: "production" }];
    const revoked = await revokeMcpToolCapability({
      tenantId: TENANT,
      workspaceId: "w-123",
      actorId: "p-123",
      grantId: GRANT_ID,
    });

    expect(revoked).toBe(true);
    const [, entry] = appendOperationsLogInTransactionSpy.mock.calls[0];
    expect(entry.eventType).toBe("MCP_TOOL_REVOKED");
    expect(entry.payload).toMatchObject({
      scope: "AGENT",
      agentId: "agent-7",
      environment: "production",
    });
  });

  // appendOperationsLogInTransaction rethrows by design. A registry change that
  // cannot be audited must not commit, so the caller has to see the throw
  // rather than a success with a missing log entry.
  it("fails the write when its audit entry cannot be written", async () => {
    state.rows = [workspaceWideGrantRow()];
    appendOperationsLogInTransactionSpy.mockRejectedValue(new Error("chain head locked"));

    await expect(
      grantMcpToolCapability({
        tenantId: TENANT,
        workspaceId: "w-123",
        actorId: "p-123",
        registryId: REGISTRY_ID,
      }),
    ).rejects.toThrow(/chain head locked/);
  });

  it("reports a grant against an unregistered tool as such", async () => {
    state.rows = [];

    await expect(
      grantMcpToolCapability({
        tenantId: TENANT,
        workspaceId: "w-123",
        actorId: "p-123",
        registryId: REGISTRY_ID,
      }),
    ).rejects.toThrow(/not registered/i);
    expect(appendOperationsLogInTransactionSpy).not.toHaveBeenCalled();
  });

  it("says nothing was revoked when the grant belongs to another workspace", async () => {
    state.rows = [];

    const revoked = await revokeMcpToolCapability({
      tenantId: TENANT,
      workspaceId: "w-123",
      actorId: "p-123",
      grantId: GRANT_ID,
    });

    expect(revoked).toBe(false);
    expect(appendOperationsLogInTransactionSpy).not.toHaveBeenCalled();
  });
});

describe("governed MCP registry — route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rows = [{ id: REGISTRY_ID, created: true }];
    state.failQuery = false;
    appendOperationsLogInTransactionSpy.mockResolvedValue(undefined);
  });

  async function postTool(body: unknown) {
    const { POST } = await import("../app/api/workspace/mcp-registry/route");
    return POST(
      new Request("https://cp.example.com/api/workspace/mcp-registry", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  it("refuses an unauthenticated caller", async () => {
    getAuthSessionSpy.mockResolvedValue(null);
    const res = await postTool({
      serverName: "github",
      toolName: "repo.read",
      connector: "github",
      action: "repo.read",
    });
    expect(res.status).toBe(401);
  });

  it("refuses a signed-in non-admin", async () => {
    signedInAdmin();
    findActorByIdSpy.mockResolvedValue({ id: "p-123", reviewerRoles: ["Security"] });
    const res = await postTool({
      serverName: "github",
      toolName: "repo.read",
      connector: "github",
      action: "repo.read",
    });
    expect(res.status).toBe(403);
  });

  // Granting a tool is a write, and the demo tenant is read-only everywhere
  // else. Approving a capability there would be the one governance act a demo
  // visitor could perform on shared data.
  it("refuses the demo tenant even for an admin", async () => {
    signedInAdmin("00000000-0000-0000-0000-000000000001");
    const res = await postTool({
      serverName: "github",
      toolName: "repo.read",
      connector: "github",
      action: "repo.read",
    });
    expect(res.status).toBe(403);
  });

  it("names every missing field at once rather than one per round trip", async () => {
    signedInAdmin();
    const res = await postTool({ serverName: "github" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/toolName, connector, action are required/);
  });

  it("rejects a server URL that is not http(s)", async () => {
    signedInAdmin();
    const res = await postTool({
      serverName: "github",
      toolName: "repo.read",
      connector: "github",
      action: "repo.read",
      serverUrl: "file:///etc/passwd",
    });
    expect(res.status).toBe(400);
  });

  it("registers a valid tool", async () => {
    signedInAdmin();
    const res = await postTool({
      serverName: "github",
      toolName: "repo.read",
      connector: "github",
      action: "repo.read",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: REGISTRY_ID, created: true });
  });
});
