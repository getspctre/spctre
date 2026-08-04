import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushBuffer, pushToBuffer } from "../src/buffer.js";
import type { SpctreCliConfig } from "../src/config.js";

let configDir: string;

const config = (): SpctreCliConfig => ({
  controlPlaneUrl: "https://control.test",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  workspaceSlug: "workspace-1",
  agentId: "agent-1",
  environment: "test",
  token: "test-token",
  tokenId: "token-1",
  tokenExpiresAt: "",
  artifactHash: "",
  branchId: "",
  revisionId: "",
  bundlePath: "",
  policyContext: [],
});

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-buffer-"));
  process.env.SPCTRE_CONFIG_DIR = configDir;
});

afterEach(() => {
  delete process.env.SPCTRE_CONFIG_DIR;
  fs.rmSync(configDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("SQLite telemetry outbox", () => {
  it("keeps FIFO order after a retryable failure and records a retry", async () => {
    pushToBuffer("evidence", { decisionId: "first" });
    pushToBuffer("evidence", { decisionId: "second" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await flushBuffer(config());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ decisionId: "first" });

    await flushBuffer(config());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ decisionId: "first" });
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({
      decisionId: "second",
    });
  });

  it("migrates legacy JSON entries before flushing them", async () => {
    const legacyDir = path.join(configDir, "telemetry-buffer");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "100-first.json"),
      JSON.stringify({ payload: { decisionId: "legacy" } }),
    );
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await flushBuffer(config());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      decisionId: "legacy",
    });
    expect(fs.existsSync(path.join(legacyDir, "100-first.json"))).toBe(false);
    expect(fs.existsSync(path.join(configDir, "telemetry-outbox.sqlite"))).toBe(true);
  });

  it("discards a 4xx entry and continues the queue", async () => {
    pushToBuffer({ decisionId: "invalid" });
    pushToBuffer({ decisionId: "valid" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 400 })
      .mockResolvedValueOnce({ status: 201 });
    vi.stubGlobal("fetch", fetchMock);

    await flushBuffer(config());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ decisionId: "valid" });
  });
});
