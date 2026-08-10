import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sync } from "../src/sync";

let tmpDir: string;
let bundlePath: string;
let logs: string[];

const BUNDLE = JSON.stringify({ rules: [] });

function bundleResponse(status: number, body: string, hash = "sha256:abc123") {
  return {
    ok: status < 400,
    status,
    statusText: status === 404 ? "Not Found" : "OK",
    text: async () => body,
    headers: {
      get: (name: string) =>
        ({
          "x-spctre-artifact-hash": hash,
          "x-spctre-branch-id": "branch-1",
          "x-spctre-revision-id": "revision-1",
        })[name] ?? null,
    },
  };
}

describe("spctre sync with no published bundle", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-cli-sync-"));
    bundlePath = path.join(tmpDir, "spctre-policy.json");
    process.env.SPCTRE_CONFIG_DIR = path.join(tmpDir, ".spctre");
    process.env.SPCTRE_SYNC_PATH = path.join(tmpDir, "last-sync.json");
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.SPCTRE_CONFIG_DIR;
    delete process.env.SPCTRE_SYNC_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports absence instead of exiting when the workspace has published nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(bundleResponse(404, '{"error":"No published policy bundle"}')),
    );

    const result = await sync({
      workspace: "workspace-1",
      key: "token-1",
      output: bundlePath,
      url: "https://control.example.com",
      quiet: true,
    });

    expect(result?.published).toBe(false);
    expect(result?.changed).toBe(false);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("does not create a bundle file when nothing is published", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bundleResponse(404, "")));

    await sync({
      workspace: "workspace-1",
      key: "token-1",
      output: bundlePath,
      url: "https://control.example.com",
      quiet: true,
    });

    expect(fs.existsSync(bundlePath)).toBe(false);
  });

  it("leaves an already-synced bundle in place when the bundle is later unpublished", async () => {
    fs.writeFileSync(bundlePath, BUNDLE);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bundleResponse(404, "")));

    const result = await sync({
      workspace: "workspace-1",
      key: "token-1",
      output: bundlePath,
      url: "https://control.example.com",
      quiet: true,
    });

    expect(result?.published).toBe(false);
    expect(fs.readFileSync(bundlePath, "utf8")).toBe(BUNDLE);
  });

  it("writes the bundle and reports it published on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bundleResponse(200, BUNDLE)));

    const result = await sync({
      workspace: "workspace-1",
      key: "token-1",
      output: bundlePath,
      url: "https://control.example.com",
      quiet: true,
    });

    expect(result?.published).toBe(true);
    expect(result?.artifactHash).toBe("sha256:abc123");
    expect(fs.readFileSync(bundlePath, "utf8")).toBe(BUNDLE);
  });

  it("still fails loudly when the control plane returns a real error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bundleResponse(500, "boom")));

    await expect(
      sync({
        workspace: "workspace-1",
        key: "token-1",
        output: bundlePath,
        url: "https://control.example.com",
        quiet: true,
      }),
    ).rejects.toThrow("exit:1");
  });
});
