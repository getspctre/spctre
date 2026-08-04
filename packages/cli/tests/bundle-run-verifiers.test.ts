import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

import { bundleRunVerifiers } from "../src/bundle-export";
import * as childProcess from "node:child_process";

const spawnSyncMock = vi.mocked(childProcess.spawnSync);

let tmpDir: string;

const baseManifest = {
  format: "opa-rego",
  target: "Open Policy Agent Rego policy",
  compatibilityLevel: "NATIVE",
  semanticWarnings: [],
  blockingWarnings: [],
  verificationTargets: ["opa check", "opa test"],
  artifactHash: "sha256:artifact",
  compiledArtifactHash: "sha256:compiled",
  generatedAt: "2026-07-06T00:00:00.000Z",
  provenance: {
    tenantId: "t",
    workspaceId: "w",
    branchId: "b",
    revisionId: "r",
    sourceHash: "sha256:src",
    sourceFormat: "SPCTRE_MANAGED",
    targetStacks: [],
  },
  ruleCount: 1,
};

describe("bundleRunVerifiers", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-run-verifiers-"));
    process.env.SPCTRE_CONFIG_DIR = path.join(tmpDir, ".spctre");
    fs.mkdirSync(process.env.SPCTRE_CONFIG_DIR, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SPCTRE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixtures(manifest = baseManifest): { artifactPath: string; manifestPath: string } {
    const artifactPath = path.join(tmpDir, "policy.rego");
    const manifestPath = path.join(tmpDir, "policy.rego.manifest.json");
    fs.writeFileSync(artifactPath, "package spctre.policy\n");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    return { artifactPath, manifestPath };
  }

  it("reports pass when all verifier tools exit 0", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { artifactPath, manifestPath } = writeFixtures();
    const result = await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(result?.ok).toBe(true);
    expect(result?.results.every((r) => r.status === "pass")).toBe(true);
  });

  it("fails when all tools are missing (nothing ran)", async () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      error: Object.assign(new Error("spawn opa ENOENT"), { code: "ENOENT" }),
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { artifactPath, manifestPath } = writeFixtures();
    const result = await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(result?.ok).toBe(false);
    expect(result?.results.every((r) => r.status === "skipped")).toBe(true);
    expect(result?.results[0].reason).toContain("not found in PATH");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--allow-missing-tools"));
  });

  it("fails when any tool is missing without --allow-missing-tools", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null })
      .mockReturnValueOnce({
        status: null,
        error: Object.assign(new Error("spawn opa ENOENT"), { code: "ENOENT" }),
        stdout: "",
        stderr: "",
        pid: 0,
        output: [],
        signal: null,
      });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { artifactPath, manifestPath } = writeFixtures();
    const result = await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(result?.ok).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("passes when some tools are missing with --allow-missing-tools and at least one passes", async () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null })
      .mockReturnValueOnce({
        status: null,
        error: Object.assign(new Error("spawn opa ENOENT"), { code: "ENOENT" }),
        stdout: "",
        stderr: "",
        pid: 0,
        output: [],
        signal: null,
      });

    const { artifactPath, manifestPath } = writeFixtures();
    const result = await bundleRunVerifiers({
      artifact: artifactPath,
      manifest: manifestPath,
      allowMissingTools: true,
    });

    expect(result?.ok).toBe(true);
    expect(result?.results[0].status).toBe("pass");
    expect(result?.results[1].status).toBe("skipped");
  });

  it("fails even with --allow-missing-tools when all tools are skipped", async () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      error: Object.assign(new Error("spawn opa ENOENT"), { code: "ENOENT" }),
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { artifactPath, manifestPath } = writeFixtures();
    const result = await bundleRunVerifiers({
      artifact: artifactPath,
      manifest: manifestPath,
      allowMissingTools: true,
    });

    expect(result?.ok).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("reports fail and exits non-zero when a tool exits with non-zero status", async () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "parse error at line 3",
      pid: 1,
      output: [],
      signal: null,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { artifactPath, manifestPath } = writeFixtures();
    const result = await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(result?.ok).toBe(false);
    expect(result?.results.some((r) => r.status === "fail")).toBe(true);
    expect(result?.results.find((r) => r.status === "fail")?.reason).toContain("parse error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("outputs JSON when --output json is set", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { artifactPath, manifestPath } = writeFixtures();
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath, output: "json" });

    const jsonCall = (console.log as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => {
        try {
          const parsed = JSON.parse(args[0] as string) as { ok: boolean; results: unknown[] };
          return typeof parsed.ok === "boolean" && Array.isArray(parsed.results);
        } catch {
          return false;
        }
      },
    );
    expect(jsonCall).toBeDefined();
  });

  it("invokes opa check and opa test with the artifact path, not manifest display strings", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const { artifactPath, manifestPath } = writeFixtures();
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(spawnSyncMock).toHaveBeenCalledWith("opa", ["check", artifactPath], expect.any(Object));
    expect(spawnSyncMock).toHaveBeenCalledWith("opa", ["test", artifactPath], expect.any(Object));
  });

  it("invokes spctre bundle verify with --artifact and --manifest flags for spctre-json format", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const spctreJsonManifest = { ...baseManifest, format: "spctre-json" };
    const { artifactPath, manifestPath } = writeFixtures(spctreJsonManifest);
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    // spctre bundle verify must receive --artifact and --manifest flags; agt verify is informational
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "spctre",
      ["bundle", "verify", "--artifact", artifactPath, "--manifest", manifestPath],
      expect.any(Object),
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it("exits ok without invoking spawnSync when all dispatch targets are informational", async () => {
    const mcpManifest = { ...baseManifest, format: "mcp-proxy-config" };
    const { artifactPath, manifestPath } = writeFixtures(mcpManifest);
    const result = await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(result?.ok).toBe(true);
    expect(result?.results.every((r) => r.status === "informational")).toBe(true);
  });

  it("fails closed when no dispatch specs exist for an unknown format", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const unknownManifest = { ...baseManifest, format: "unknown-format" };
    const { artifactPath, manifestPath } = writeFixtures(unknownManifest);
    const result = await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(result?.ok).toBe(false);
    expect(result?.results).toHaveLength(0);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("warns to stderr that nothing was checked for an unmapped format", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const unknownManifest = { ...baseManifest, format: "unknown-format" };
    const { artifactPath, manifestPath } = writeFixtures(unknownManifest);
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No verifiers are configured for format "unknown-format"'),
    );
  });

  it("does not warn about unmapped format for a known informational-only format", async () => {
    const mcpManifest = { ...baseManifest, format: "mcp-proxy-config" };
    const { artifactPath, manifestPath } = writeFixtures(mcpManifest);
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("No verifiers are configured for format"),
    );
  });

  it("names the actual missing executable in the install hint (spctre for spctre-json)", async () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      error: Object.assign(new Error("spawn spctre ENOENT"), { code: "ENOENT" }),
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const spctreJsonManifest = { ...baseManifest, format: "spctre-json" };
    const { artifactPath, manifestPath } = writeFixtures(spctreJsonManifest);
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Install spctre"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("includes failed and informational counts in JSON output", async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const spctreJsonManifest = { ...baseManifest, format: "spctre-json" };
    const { artifactPath, manifestPath } = writeFixtures(spctreJsonManifest);
    await bundleRunVerifiers({ artifact: artifactPath, manifest: manifestPath, output: "json" });

    const logCalls = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    const jsonCall = logCalls.find((c) => c.trim().startsWith("{"));
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall as string);
    expect(parsed).toMatchObject({ passed: 1, failed: 0, skipped: 0, informational: 1 });
  });
});
