import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { policyConvert } from "../src/policy-convert";
import { policyImport } from "../src/policy-import";

describe("spctre policy convert", () => {
  let tmpDir: string;
  let sourcePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-policy-convert-"));
    sourcePath = path.join(tmpDir, "github.cedar");
    fs.writeFileSync(
      sourcePath,
      'forbid(principal, action == Action::"github.repo.delete", resource);\n',
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a local AGT document and conversion report without a network request", async () => {
    const output = path.join(tmpDir, "policy.json");
    const report = path.join(tmpDir, "report.json");
    await policyConvert(sourcePath, { output, report, acceptLossy: true });

    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({
      rules: [{ effect: "DENY", connectors: ["github"], actions: ["repo.delete"] }],
    });
    expect(JSON.parse(fs.readFileSync(report, "utf8"))).toMatchObject({
      ok: true,
      sourceFormat: "CEDAR",
      translation: { status: "LOSSY" },
    });
  });

  it("makes --offline import an alias for local conversion", async () => {
    const output = path.join(tmpDir, "offline.json");
    vi.stubGlobal("fetch", vi.fn());
    await policyImport(sourcePath, { offline: true, output, acceptLossy: true });
    expect(fs.existsSync(output)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid source format before conversion", async () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    await expect(policyConvert(sourcePath, { sourceFormat: "cedar" as "CEDAR" })).rejects.toThrow(
      "exit:1",
    );
  });

  it("explains how to accept a lossy conversion in default text output", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args.join(" ")));
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(policyConvert(sourcePath, {})).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toContain("re-run with --accept-lossy");
  });
});
