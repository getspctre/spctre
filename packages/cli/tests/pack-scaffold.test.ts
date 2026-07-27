import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packScaffold } from "../src/pack-scaffold";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("pack scaffold", () => {
  it("should generate a connector pack with default name and output directory", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-pack-scaffold-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await packScaffold(undefined, { version: "1.0.0" });

    const generatedDir = path.join(tempDir, "spctre-pack-custom-connector");
    expect(fs.existsSync(generatedDir)).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, "rules.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, "schema.json"))).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, ".github", "workflows", "lint-pack.yml"))).toBe(true);

    const rulesContent = fs.readFileSync(path.join(generatedDir, "rules.yaml"), "utf8");
    expect(rulesContent).toContain('connector: "custom-connector"');
    expect(rulesContent).toContain('name: "custom-connector Governance Pack"');
    expect(rulesContent).toContain('version: "1.0.0"');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Success! Governance pack scaffolded"));
  });

  it("should generate a connector pack with custom parameters", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-pack-scaffold-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await packScaffold("stripe", {
      output: "custom-stripe-dir",
      connector: "stripe-prod",
      version: "2.1.3",
    });

    const generatedDir = path.join(tempDir, "custom-stripe-dir");
    expect(fs.existsSync(generatedDir)).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, "rules.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, "schema.json"))).toBe(true);
    expect(fs.existsSync(path.join(generatedDir, ".github", "workflows", "lint-pack.yml"))).toBe(true);

    const readmeContent = fs.readFileSync(path.join(generatedDir, "README.md"), "utf8");
    expect(readmeContent).toContain("# Spctre Connector Governance Pack: stripe");

    const rulesContent = fs.readFileSync(path.join(generatedDir, "rules.yaml"), "utf8");
    expect(rulesContent).toContain('connector: "stripe-prod"');
    expect(rulesContent).toContain('name: "stripe Governance Pack"');
    expect(rulesContent).toContain('version: "2.1.3"');

    const schemaContent = JSON.parse(fs.readFileSync(path.join(generatedDir, "schema.json"), "utf8"));
    expect(schemaContent.title).toBe("Spctre Governance Pack Schema");

    const workflowContent = fs.readFileSync(path.join(generatedDir, ".github", "workflows", "lint-pack.yml"), "utf8");
    expect(workflowContent).toContain("name: Lint Spctre Governance Pack");

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Success! Governance pack scaffolded"));
  });
});
