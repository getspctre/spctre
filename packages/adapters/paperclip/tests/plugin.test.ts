import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpctrePaperclipPlugin } from "../src/plugin.js";
import type { DispatchContext, HeartbeatPayload } from "../src/types.js";

const BASE_OPTIONS = {
  apiKey: "test-key",
  baseUrl: "https://spctre.example.com",
  agentId: "agent-001",
  tenantId: "tenant-001",
  workspaceId: "ws-001",
};

function makePlugin(overrides?: Partial<typeof BASE_OPTIONS> & { dryRun?: boolean }) {
  return new SpctrePaperclipPlugin({ ...BASE_OPTIONS, ...overrides });
}

describe("SpctrePaperclipPlugin", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits evidence with stack=PAPERCLIP and orchestratorRef.platform=paperclip", async () => {
    const plugin = makePlugin();
    const ctx: DispatchContext = { toolName: "bash", toolArgs: { command: "ls" } };

    const result = await plugin.beforeToolDispatch(ctx);
    expect(result.action).toBe("allow");

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.runtimeTarget.stack).toBe("PAPERCLIP");
    expect(body.orchestratorRef.platform).toBe("paperclip");
    expect(body.ingestMode).toBe("gateway");
  });

  it("sets triggerKind=routine when dispatchContext.isRoutine=true", async () => {
    const plugin = makePlugin();
    const ctx: DispatchContext = { toolName: "file_read", isRoutine: true };

    await plugin.beforeToolDispatch(ctx);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.triggerKind).toBe("routine");
  });

  it("sets triggerKind=interactive when dispatchContext.isRoutine is absent", async () => {
    const plugin = makePlugin();
    const ctx: DispatchContext = { toolName: "file_read" };

    await plugin.beforeToolDispatch(ctx);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.triggerKind).toBe("interactive");
  });

  it("sets trustLevel=low when dispatchContext.trustPreset=low", async () => {
    const plugin = makePlugin();
    const ctx: DispatchContext = { toolName: "bash", trustPreset: "low" };

    await plugin.beforeToolDispatch(ctx);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.trustLevel).toBe("low");
  });

  it("populates orchestratorRef from dispatchContext companyId, issueId, goalId", async () => {
    const plugin = makePlugin();
    const ctx: DispatchContext = {
      toolName: "bash",
      companyId: "company-42",
      issueId: "issue-7",
      goalId: "goal-99",
    };

    await plugin.beforeToolDispatch(ctx);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.orchestratorRef.companyId).toBe("company-42");
    expect(body.orchestratorRef.issueId).toBe("issue-7");
    expect(body.orchestratorRef.goalId).toBe("goal-99");
  });

  it("skips fetch and allows when dryRun=true", async () => {
    const plugin = makePlugin({ dryRun: true });
    const ctx: DispatchContext = { toolName: "bash" };

    const result = await plugin.beforeToolDispatch(ctx);
    expect(result.action).toBe("allow");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("register() wires beforeToolDispatch into the dispatcher", () => {
    const plugin = makePlugin();
    const registered: unknown[] = [];
    const dispatcher = { registerBeforeToolDispatch: (fn: unknown) => registered.push(fn) };

    plugin.register(dispatcher);

    expect(registered).toHaveLength(1);
    expect(registered[0]).toBe(plugin.beforeToolDispatch);
  });

  it("onHeartbeat emits a heartbeat evidence record", async () => {
    const plugin = makePlugin();
    const payload: HeartbeatPayload = {
      agentId: "agent-001",
      companyId: "company-42",
      issueId: "issue-7",
      goalId: "goal-99",
      runStatus: "running",
      timestamp: "2026-07-01T00:00:00.000Z",
    };

    await plugin.onHeartbeat(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/evidence");
    const body = JSON.parse(init.body as string);
    // Contract fields
    expect(body.agentId).toBe("agent-001");
    expect(body.action).toBe("heartbeat");
    expect(body.status).toBe("ALLOW");
    expect(body.ingestMode).toBe("gateway");
    expect(typeof body.decisionId).toBe("string");
    expect(body.decisionId.length).toBeGreaterThan(0);
    // Heartbeat-specific fields carried in rawEvidence
    expect(body.rawEvidence.type).toBe("HEARTBEAT");
    expect(body.rawEvidence.runStatus).toBe("running");
    expect(body.rawEvidence.companyId).toBe("company-42");
    expect(body.rawEvidence.issueId).toBe("issue-7");
    expect(body.rawEvidence.goalId).toBe("goal-99");
  });

  it("onHeartbeat is a no-op when dryRun=true", async () => {
    const plugin = makePlugin({ dryRun: true });
    await plugin.onHeartbeat({ agentId: "agent-001", runStatus: "idle" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("evidence emission failure does not reject beforeToolDispatch", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));
    const plugin = makePlugin();
    const ctx: DispatchContext = { toolName: "bash" };

    const result = await plugin.beforeToolDispatch(ctx);
    expect(result.action).toBe("allow");
  });
});
