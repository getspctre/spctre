import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpctreOpenClawAdapter } from "../src/index.js";

function makeAdapter(options: { dryRun?: boolean } = {}) {
  return new SpctreOpenClawAdapter({
    apiKey: "spctre-key",
    baseUrl: "https://spctre.example/api/v1",
    agentId: "agent-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    dryRun: options.dryRun,
  });
}

type TestStatus = "ALLOW" | "WARN" | "DENY" | "ESCALATE";

function reasonForStatus(status: TestStatus): string {
  if (status === "DENY") return "Denied by test rule.";
  if (status === "ESCALATE") return "Escalated by test rule.";
  if (status === "WARN") return "Warned by test rule.";
  return "Allowed by test rule.";
}

function mockFetchForStatus(status: TestStatus = "ALLOW") {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/evaluate")) {
      return new Response(JSON.stringify({
        artifactHash: "artifact-1",
        result: {
          status,
          reason: reasonForStatus(status),
          matchedRefs: ["rule-1"],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.endsWith("/evidence")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected URL: ${target} (${JSON.stringify(init)})`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchWithEvidenceFailure(status: TestStatus = "ALLOW") {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/evaluate")) {
      return new Response(JSON.stringify({
        artifactHash: "artifact-1",
        result: {
          status,
          reason: reasonForStatus(status),
          matchedRefs: ["rule-1"],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (target.endsWith("/evidence")) {
      return new Response(JSON.stringify({ error: "ingest unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected URL: ${target} (${JSON.stringify(init)})`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function evidenceBody(fetchMock: ReturnType<typeof mockFetchForStatus>) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/evidence"));
  expect(call).toBeDefined();
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

describe("SpctreOpenClawAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("emits OPENCLAW interactive evidence for a normal tool call", async () => {
    const fetchMock = mockFetchForStatus();
    const adapter = makeAdapter();

    const result = await adapter.beforeToolCall("sendMessage", { text: "hello" }, {});

    expect(result).toEqual({ action: "allow" });
    const evidence = evidenceBody(fetchMock);
    expect(evidence.runtimeTarget).toMatchObject({ stack: "OPENCLAW", adapter: "@spctre/openclaw", environment: "production" });
    expect(evidence.triggerKind).toBe("interactive");
    expect(evidence.connector).toBe("openclaw");
    expect(evidence.action).toBe("sendMessage");
    expect(evidence.ingestMode).toBe("gateway");
  });

  it("sets triggerKind scheduled for cron contexts", async () => {
    const fetchMock = mockFetchForStatus();
    const adapter = makeAdapter();

    await adapter.beforeToolCall("dailyDigest", {}, { cron: true });

    expect(evidenceBody(fetchMock).triggerKind).toBe("scheduled");
  });

  it("sets triggerKind gateway_message for channel contexts", async () => {
    const fetchMock = mockFetchForStatus();
    const adapter = makeAdapter();

    await adapter.beforeToolCall("reply", {}, { channel: "discord" });

    const evidence = evidenceBody(fetchMock);
    expect(evidence.triggerKind).toBe("gateway_message");
    expect(evidence.executionContext).toMatchObject({ channel: "discord" });
  });

  it("blocks the tool call when Spctre evaluate returns DENY", async () => {
    mockFetchForStatus("DENY");
    const adapter = makeAdapter();

    const result = await adapter.beforeToolCall("deleteWorkspace", {}, {});

    expect(result).toEqual({ action: "block", reason: "Denied by test rule." });
  });

  it("blocks the tool call when Spctre evaluate returns ESCALATE", async () => {
    const fetchMock = mockFetchForStatus("ESCALATE");
    const adapter = makeAdapter();

    const result = await adapter.beforeToolCall("exportCustomerData", {}, {});

    expect(result).toEqual({ action: "block", reason: "Escalated by test rule." });
    expect(evidenceBody(fetchMock).status).toBe("ESCALATE");
  });

  it("allows WARN decisions while still emitting evidence", async () => {
    const fetchMock = mockFetchForStatus("WARN");
    const adapter = makeAdapter();

    const result = await adapter.beforeToolCall("sendMessage", {}, {});

    expect(result).toEqual({ action: "allow" });
    expect(evidenceBody(fetchMock).status).toBe("WARN");
  });

  it("blocks DENY decisions even when evidence ingest fails", async () => {
    const fetchMock = mockFetchWithEvidenceFailure("DENY");
    const adapter = makeAdapter();

    const result = await adapter.beforeToolCall("deleteWorkspace", {}, {});

    expect(result).toEqual({ action: "block", reason: "Denied by test rule." });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evidence"))).toBe(true);
  });

  it("blocks ESCALATE decisions even when evidence ingest fails", async () => {
    const fetchMock = mockFetchWithEvidenceFailure("ESCALATE");
    const adapter = makeAdapter();

    const result = await adapter.beforeToolCall("exportCustomerData", {}, {});

    expect(result).toEqual({ action: "block", reason: "Escalated by test rule." });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evidence"))).toBe(true);
  });

  it("skips fetch and allows when dryRun is enabled", async () => {
    const fetchMock = mockFetchForStatus("DENY");
    const adapter = makeAdapter({ dryRun: true });

    const result = await adapter.beforeToolCall("deleteWorkspace", {}, {});

    expect(result).toEqual({ action: "allow" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
