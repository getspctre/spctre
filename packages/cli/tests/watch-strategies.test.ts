import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncMock = vi.fn();
const ingestMock = vi.fn();
const readConfigMock = vi.fn();

vi.mock("../src/sync", () => ({ sync: (...args: unknown[]) => syncMock(...args) }));
vi.mock("../src/ingest", () => ({ ingest: (...args: unknown[]) => ingestMock(...args) }));
vi.mock("../src/config", () => ({ readConfig: () => readConfigMock() }));
vi.mock("../src/refresh", () => ({ refreshIfNeeded: async (config: unknown) => config }));

const { createWatchStrategies } = await import("../src/watch-strategies");

const OPTIONS = {
  interval: "30",
  heartbeat: true,
  heartbeatInterval: "30",
  quiet: false,
  shadow: false,
};

let logs: string[];

async function runStrategies() {
  const strategies = createWatchStrategies(OPTIONS, 30, 30);
  for (const strategy of strategies) await strategy.start();
  for (const strategy of strategies) strategy.stop();
}

describe("watch strategies without a published bundle", () => {
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    syncMock.mockReset();
    ingestMock.mockReset();
    readConfigMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps watching and skips the heartbeat when nothing is published", async () => {
    syncMock.mockResolvedValue({
      outputPath: "spctre-policy.json",
      artifactHash: "",
      previousHash: null,
      changed: false,
      published: false,
    });
    readConfigMock.mockReturnValue({ agentId: "agent-1", workspaceId: "workspace-1" });

    await runStrategies();

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(ingestMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("No policy bundle has been published");
    expect(logs.join("\n")).toContain("Skipping heartbeat");
  });

  it("sends the heartbeat once a bundle is published", async () => {
    syncMock.mockResolvedValue({
      outputPath: "spctre-policy.json",
      artifactHash: "sha256:abc123",
      previousHash: null,
      changed: true,
      published: true,
    });
    readConfigMock.mockReturnValue({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      artifactHash: "sha256:abc123",
    });

    await runStrategies();

    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(ingestMock.mock.calls[0][0]).toMatchObject({ heartbeat: true, hash: "sha256:abc123" });
    expect(logs.join("\n")).not.toContain("Skipping heartbeat");
  });
});
