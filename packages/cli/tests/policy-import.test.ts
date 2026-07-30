import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { policyImport } from "../src/policy-import";

let tmpDir: string;
let policyFile: string;
let logs: string[];

const POLICY = [
  "metadata:",
  "  name: Test",
  "  connector: acquisition-scout",
  "rules:",
  "  - stable_rule_id: test.allow_read",
  "    title: Allow read",
  "    effect: ALLOW",
  "    connectors: [acquisition-scout]",
  "    actions: [research.fetch]",
].join("\n") + "\n";

function okResponse(body: Record<string, unknown>, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("spctre policy import", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-cli-import-"));
    policyFile = path.join(tmpDir, "scout.policy.yaml");
    fs.writeFileSync(policyFile, POLICY);
    // Isolate from any real .spctre config discovered via cwd.
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

  it("POSTs the file to the import API with a CONNECTOR scope derived from --connector", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse({
      branchId: "b1", revisionId: "r1", sourceHash: "sha256:abc", created: true, alreadyCurrent: false, ruleCount: 1,
    }, 201));
    vi.stubGlobal("fetch", fetchSpy);

    await policyImport(policyFile, { connector: "acquisition-scout", key: "spctre_svc_xyz", url: "https://control.test/" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://control.test/api/v1/policy/imports");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer spctre_svc_xyz");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ branchName: "acquisition-scout", connector: "acquisition-scout", scope: "CONNECTOR", source: POLICY });
    expect(logs.join("\n")).toContain("branch created");
    expect(logs.join("\n")).toContain("unapproved draft");
  });

  it("reports an already-current import without the draft reminder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({
      branchId: "b1", revisionId: "r1", sourceHash: "sha256:abc", created: false, alreadyCurrent: true, ruleCount: 1,
    }, 200)));

    await policyImport(policyFile, { branch: "acquisition-scout", key: "k", url: "https://control.test" });

    expect(logs.join("\n")).toContain("already current");
    expect(logs.join("\n")).not.toContain("unapproved draft");
  });

  it("exits non-zero when the API returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ error: "Token is missing policy:import scope." }, 401)));

    await expect(policyImport(policyFile, { key: "k", url: "https://control.test" })).rejects.toThrow("exit:1");
  });

  it("exits non-zero when no key is available", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(policyImport(policyFile, { url: "https://control.test" })).rejects.toThrow("exit:1");
  });

  it("exits non-zero when the file does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(policyImport(path.join(tmpDir, "missing.yaml"), { key: "k" })).rejects.toThrow("exit:1");
  });
});
