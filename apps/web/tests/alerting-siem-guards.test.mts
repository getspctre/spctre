import { beforeEach, describe, expect, it, vi } from "vitest";

// The guard chain in front of every alerting and SIEM mutation.
//
// Both domains configure where governance signals get sent, so both carry the
// same two risks: writing into a workspace the caller does not hold, and
// pointing a dispatcher at an address the URL guard exists to refuse. Every
// mutation repeats the same guards inline, which is exactly the shape that
// rots — one new mutation written without them looks identical in review.
//
// So these are driven from a table of the mutations rather than written out
// per function: adding a mutation to the domain without adding it here leaves
// the table incomplete, and the guard tests below cover whatever is in it.

const getAuthSessionSpy = vi.fn();
const getRequiredWorkspaceContextSpy = vi.fn();
const validateWebhookUrlSpy = vi.fn();
const validateSentinelWorkspaceIdSpy = vi.fn();
const isFeatureEntitledSpy = vi.fn();

const createAlertingIntegrationSpy = vi.fn();
const deleteAlertingIntegrationSpy = vi.fn();
const createAlertingRuleSpy = vi.fn();
const deleteAlertingRuleSpy = vi.fn();

const createSiemStreamSpy = vi.fn();
const deleteSiemStreamSpy = vi.fn();
const toggleSiemStreamSpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));
vi.mock("@/lib/workspace", () => ({
  getWorkspaceContext: vi.fn(),
  getRequiredWorkspaceContext: getRequiredWorkspaceContextSpy,
}));
vi.mock("@/lib/platform/url-guard", () => ({
  validateWebhookUrl: validateWebhookUrlSpy,
  validateSentinelWorkspaceId: validateSentinelWorkspaceIdSpy,
}));
vi.mock("@/lib/entitlements/features", () => ({ isFeatureEntitled: isFeatureEntitledSpy }));
vi.mock("@/lib/repositories/alerting", () => ({
  listAlertingIntegrations: vi.fn(),
  listAlertingRules: vi.fn(),
  createAlertingIntegration: createAlertingIntegrationSpy,
  deleteAlertingIntegration: deleteAlertingIntegrationSpy,
  createAlertingRule: createAlertingRuleSpy,
  deleteAlertingRule: deleteAlertingRuleSpy,
}));
vi.mock("@/lib/repositories/siem-stream", () => ({
  listSiemStreams: vi.fn(),
  createSiemStream: createSiemStreamSpy,
  deleteSiemStream: deleteSiemStreamSpy,
  toggleSiemStream: toggleSiemStreamSpy,
}));

const alerting = await import("../lib/domains/alerting/service");
const siem = await import("../lib/domains/siem-stream/service");

const TENANT = "tenant-1";
const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";

/** Every mutation, with arguments naming the workspace the caller claims. */
const MUTATIONS: Array<{
  label: string;
  writes: () => ReturnType<typeof vi.fn>;
  call: (workspaceId: string) => Promise<unknown>;
}> = [
  {
    label: "alerting: add integration",
    writes: () => createAlertingIntegrationSpy,
    call: (workspaceId) =>
      alerting.addAlertingIntegrationDecision({
        workspaceId,
        name: "Ops Slack",
        type: "SLACK",
        url: "https://hooks.slack.test/abc",
      }),
  },
  {
    label: "alerting: remove integration",
    writes: () => deleteAlertingIntegrationSpy,
    call: (workspaceId) =>
      alerting.removeAlertingIntegrationDecision({ workspaceId, id: "integration-1" }),
  },
  {
    label: "alerting: add rule",
    writes: () => createAlertingRuleSpy,
    call: (workspaceId) =>
      alerting.addAlertingRuleDecision({
        workspaceId,
        name: "High risk",
        enabled: true,
        connector: "stripe",
        minRiskLevel: "HIGH",
        minFrequency: 3,
        frequencyWindowMinutes: 60,
        integrationId: "integration-1",
      }),
  },
  {
    label: "alerting: remove rule",
    writes: () => deleteAlertingRuleSpy,
    call: (workspaceId) => alerting.removeAlertingRuleDecision({ workspaceId, id: "rule-1" }),
  },
  {
    label: "siem: add stream",
    writes: () => createSiemStreamSpy,
    call: (workspaceId) =>
      siem.addSiemStreamDecision({
        workspaceId,
        name: "Splunk",
        type: "SPLUNK_HEC",
        url: "https://splunk.test/services/collector",
        credentials: { token: "hec-token" },
      }),
  },
  {
    label: "siem: remove stream",
    writes: () => deleteSiemStreamSpy,
    call: (workspaceId) => siem.removeSiemStreamDecision({ workspaceId, id: "stream-1" }),
  },
  {
    label: "siem: toggle stream",
    writes: () => toggleSiemStreamSpy,
    call: (workspaceId) =>
      siem.toggleSiemStreamDecision({ workspaceId, id: "stream-1", enabled: false }),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getAuthSessionSpy.mockResolvedValue({ tenantId: TENANT, principalId: "p-1" });
  getRequiredWorkspaceContextSpy.mockResolvedValue({ tenantId: TENANT, workspaceId: WORKSPACE });
  isFeatureEntitledSpy.mockResolvedValue(true);
  process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY = "test-key";
});

describe.each(MUTATIONS)("$label", ({ writes, call }) => {
  it("refuses an unauthenticated caller", async () => {
    getAuthSessionSpy.mockResolvedValue(null);

    await expect(call(WORKSPACE)).rejects.toThrow("AUTH_REQUIRED");
    expect(writes()).not.toHaveBeenCalled();
  });

  it("refuses a workspace the caller is not in", async () => {
    // The id arrives in the request. Without this the caller could configure
    // dispatch for another workspace by naming it.
    await expect(call(OTHER_WORKSPACE)).rejects.toThrow("INVALID_WORKSPACE");
    expect(writes()).not.toHaveBeenCalled();
  });

  it("takes the tenant from the session, never the request", async () => {
    await call(WORKSPACE);

    // Every repository write in both domains is (tenantId, workspaceId, ...).
    const [tenantId, workspaceId] = writes().mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(workspaceId).toBe(WORKSPACE);
  });
});

describe("alerting dispatch targets are validated by type", () => {
  it.each([
    ["SLACK", true],
    ["TEAMS", true],
    ["WEBHOOK", true],
    ["SPLUNK_HEC", true],
    ["PAGERDUTY", false],
    ["EMAIL", false],
  ])("%s validates the URL: %s", async (type, validated) => {
    // The set decides which destinations are checked for SSRF. A type dropping
    // out of it silently admits an internal address.
    await alerting.addAlertingIntegrationDecision({
      workspaceId: WORKSPACE,
      name: "Target",
      type: type as "SLACK",
      url: "https://example.test/hook",
    });

    expect(validateWebhookUrlSpy).toHaveBeenCalledTimes(validated ? 1 : 0);
    expect(validateSentinelWorkspaceIdSpy).not.toHaveBeenCalled();
  });

  it("validates SENTINEL as a workspace id rather than a URL", async () => {
    await alerting.addAlertingIntegrationDecision({
      workspaceId: WORKSPACE,
      name: "Sentinel",
      type: "SENTINEL",
      url: "8f14e45f-ceea-467a-9f3a-5d2f4d5b0000",
    });

    expect(validateSentinelWorkspaceIdSpy).toHaveBeenCalledWith(
      "8f14e45f-ceea-467a-9f3a-5d2f4d5b0000",
    );
    expect(validateWebhookUrlSpy).not.toHaveBeenCalled();
  });

  it("does not write when the URL guard refuses", async () => {
    // Scoped to this call: clearAllMocks resets call history, not
    // implementations, so a persistent throw here would leak into every test
    // that runs after it.
    validateWebhookUrlSpy.mockImplementationOnce(() => {
      throw new Error("Refusing a private address.");
    });

    await expect(
      alerting.addAlertingIntegrationDecision({
        workspaceId: WORKSPACE,
        name: "Internal",
        type: "WEBHOOK",
        url: "http://169.254.169.254/latest/meta-data",
      }),
    ).rejects.toThrow("Refusing a private address.");
    expect(createAlertingIntegrationSpy).not.toHaveBeenCalled();
  });

  it("defaults the config to an empty object rather than undefined", async () => {
    await alerting.addAlertingIntegrationDecision({
      workspaceId: WORKSPACE,
      name: "Ops Slack",
      type: "SLACK",
      url: "https://hooks.slack.test/abc",
    });

    expect(createAlertingIntegrationSpy).toHaveBeenCalledWith(
      TENANT,
      WORKSPACE,
      "Ops Slack",
      "SLACK",
      "https://hooks.slack.test/abc",
      {},
    );
  });
});

describe("SIEM streaming is entitlement-gated", () => {
  const siemCalls: Array<[string, () => Promise<unknown>]> = [
    ["add", () => MUTATIONS[4].call(WORKSPACE)],
    ["remove", () => MUTATIONS[5].call(WORKSPACE)],
    ["toggle", () => MUTATIONS[6].call(WORKSPACE)],
  ];

  it.each(siemCalls)("%s requires the entitlement", async (_label, call) => {
    isFeatureEntitledSpy.mockResolvedValue(false);

    await expect(call()).rejects.toThrow("PLAN_REQUIRED");
    expect(isFeatureEntitledSpy).toHaveBeenCalledWith("siemEventStreaming", TENANT);
  });

  it("checks the entitlement before the workspace, so the refusal reveals nothing", async () => {
    // Ordering matters: checking the workspace first would let an unentitled
    // caller distinguish a workspace that exists from one that does not.
    isFeatureEntitledSpy.mockResolvedValue(false);

    await expect(MUTATIONS[5].call(OTHER_WORKSPACE)).rejects.toThrow("PLAN_REQUIRED");
  });

  it("refuses to create a stream with no credential encryption key", async () => {
    delete process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY;

    await expect(MUTATIONS[4].call(WORKSPACE)).rejects.toThrow(
      /SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set/,
    );
    expect(createSiemStreamSpy).not.toHaveBeenCalled();
  });

  it("serializes credentials and passes the encryption key through", async () => {
    await siem.addSiemStreamDecision({
      workspaceId: WORKSPACE,
      name: "Splunk",
      type: "SPLUNK_HEC",
      url: "https://splunk.test/services/collector",
      credentials: { token: "hec-token" },
    });

    expect(createSiemStreamSpy).toHaveBeenCalledWith(
      TENANT,
      WORKSPACE,
      "Splunk",
      "SPLUNK_HEC",
      "https://splunk.test/services/collector",
      {},
      JSON.stringify({ token: "hec-token" }),
      "test-key",
    );
  });

  it("validates a SENTINEL stream as a workspace id", async () => {
    await siem.addSiemStreamDecision({
      workspaceId: WORKSPACE,
      name: "Sentinel",
      type: "SENTINEL",
      url: "8f14e45f-ceea-467a-9f3a-5d2f4d5b0000",
      credentials: { sharedKey: "k" },
    });

    expect(validateSentinelWorkspaceIdSpy).toHaveBeenCalled();
    expect(validateWebhookUrlSpy).not.toHaveBeenCalled();
  });
});
