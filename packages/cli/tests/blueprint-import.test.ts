import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blueprintImport } from "../src/blueprint-import";

let tmpDir: string;
let blueprintFile: string;
let logs: string[];

const BLUEPRINT = [
  "name: Acquisition Scout",
  "agentId: scout",
  "message: Read-only researcher",
  "definition:",
  "  purpose: Read-only acquisition researcher.",
  "  allowedTaskClasses: [research]",
  "  tools: [research.fetch]",
  "  connectors: [acquisition-scout]",
  "  services: [github]",
  "  environments: [production]",
  "  runtimeTargets:",
  "    - stack: CUSTOM",
  "      adapter: spctre-scout",
  "  policyBranchId: acquisition-scout",
].join("\n") + "\n";

function okResponse(body: Record<string, unknown>, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const SUCCESS = {
  blueprintId: "bp1",
  revisionId: "rev1",
  definitionHash: "sha256:abc",
  policyBranchId: "branch-uuid",
  policyRevisionId: "revision-uuid",
};

describe("spctre blueprint import", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-cli-bp-import-"));
    blueprintFile = path.join(tmpDir, "scout.blueprint.yaml");
    fs.writeFileSync(blueprintFile, BLUEPRINT);
    process.env.SPCTRE_CONFIG_DIR = path.join(tmpDir, ".spctre");
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.SPCTRE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("POSTs the raw source to the Blueprint import API", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse({ ...SUCCESS, created: true, alreadyCurrent: false }, 201));
    vi.stubGlobal("fetch", fetchSpy);

    await blueprintImport(blueprintFile, { key: "spctre_svc_xyz", url: "https://control.test/" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://control.test/api/v1/blueprint/imports");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer spctre_svc_xyz");
    const body = JSON.parse(init.body as string);
    expect(body.source).toBe(BLUEPRINT);
    expect(logs.join("\n")).toContain("Blueprint created");
    expect(logs.join("\n")).toContain("unapproved draft");
  });

  it("reports an already-current import without the draft reminder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ...SUCCESS, created: false, alreadyCurrent: true }, 200)));

    await blueprintImport(blueprintFile, { key: "k", url: "https://control.test" });

    expect(logs.join("\n")).toContain("already current");
    expect(logs.join("\n")).not.toContain("unapproved draft");
  });

  it("validates locally on --dry-run without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await blueprintImport(blueprintFile, { dryRun: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("dry run: import skipped");
    expect(logs.join("\n")).toContain("acquisition-scout");
  });

  it("rejects a source that pins policyRevisionId", async () => {
    fs.writeFileSync(blueprintFile, BLUEPRINT + "  policyRevisionId: rev_123\n");
    vi.stubGlobal("fetch", vi.fn());

    await expect(blueprintImport(blueprintFile, { dryRun: true })).rejects.toThrow("exit:1");
  });

  it("exits non-zero when the API returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ error: "Token is missing blueprint:import scope." }, 401)));

    await expect(blueprintImport(blueprintFile, { key: "k", url: "https://control.test" })).rejects.toThrow("exit:1");
  });

  it("exits non-zero when no key is available", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(blueprintImport(blueprintFile, { url: "https://control.test" })).rejects.toThrow("exit:1");
  });

  it("exits non-zero when the file does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(blueprintImport(path.join(tmpDir, "missing.yaml"), { key: "k" })).rejects.toThrow("exit:1");
  });
});
