import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHook } from "../src/install-hook";
import { installSkill } from "../src/install-skill";

const originalCwd = process.cwd();
const originalKimiHome = process.env.KIMI_CODE_HOME;
const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  if (originalKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
  else process.env.KIMI_CODE_HOME = originalKimiHome;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createKimiHome() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-kimi-"));
  temporaryDirectories.push(directory);
  process.env.KIMI_CODE_HOME = directory;
  return path.join(directory, "config.toml");
}

function createWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-kimi-ws-"));
  temporaryDirectories.push(directory);
  process.chdir(directory);
  return directory;
}

describe("Kimi Code hook installation", () => {
  it("writes a [[hooks]] array-of-tables entry into config.toml", () => {
    const configPath = createKimiHome();

    installHook({ kimi: true, mode: "observe" });

    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toContain("[[hooks]]");
    expect(config).toContain('event = "PreToolUse"');
    expect(config).toContain('matcher = ".*"');
    expect(config).toContain(
      'command = "npx @spctre/cli pretooluse --harness kimi --mode observe"',
    );
    // Kimi rejects a [[hooks]] entry carrying any field beyond these four.
    expect(config.match(/^\w+ =/gm)).toEqual(["event =", "matcher =", "command =", "timeout ="]);
  });

  it("declares a timeout inside Kimi's 1-600s range", () => {
    const configPath = createKimiHome();

    installHook({ kimi: true, mode: "enforce" });

    const timeout = Number(/^timeout = (\d+)$/m.exec(fs.readFileSync(configPath, "utf8"))?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(1);
    expect(timeout).toBeLessThanOrEqual(600);
  });

  it("preserves unrelated config, including provider credentials and comments", () => {
    const configPath = createKimiHome();
    const original = [
      "default_model = 'kimi-for-coding'",
      "",
      "# my provider — do not touch",
      "[providers.kimi]",
      'type = "kimi"',
      'api_key = "sk-secret"',
      "",
    ].join("\n");
    fs.writeFileSync(configPath, original);

    installHook({ kimi: true, mode: "observe" });

    const config = fs.readFileSync(configPath, "utf8");
    expect(config.startsWith(original)).toBe(true);
    expect(config).toContain("# my provider — do not touch");
    expect(config).toContain('api_key = "sk-secret"');
  });

  it("appends the block after existing tables so the TOML stays valid", () => {
    const configPath = createKimiHome();
    fs.writeFileSync(configPath, '[providers.kimi]\ntype = "kimi"\n');

    installHook({ kimi: true, mode: "observe" });

    const config = fs.readFileSync(configPath, "utf8");
    // The [[hooks]] header must come after the [providers.kimi] table, or its
    // keys would be parsed as part of that table.
    expect(config.indexOf("[[hooks]]")).toBeGreaterThan(config.indexOf("[providers.kimi]"));
  });

  it("is idempotent across repeat installs", () => {
    const configPath = createKimiHome();

    installHook({ kimi: true, mode: "observe" });
    const afterFirst = fs.readFileSync(configPath, "utf8");
    installHook({ kimi: true, mode: "observe" });

    expect(fs.readFileSync(configPath, "utf8")).toBe(afterFirst);
    expect(afterFirst.match(/\[\[hooks\]\]/g)).toHaveLength(1);
  });

  it("replaces the managed block in place when the mode changes", () => {
    const configPath = createKimiHome();

    installHook({ kimi: true, mode: "observe" });
    installHook({ kimi: true, mode: "enforce" });

    const config = fs.readFileSync(configPath, "utf8");
    expect(config.match(/\[\[hooks\]\]/g)).toHaveLength(1);
    expect(config).toContain("--mode enforce");
    expect(config).not.toContain("--mode observe");
  });

  it("removes only the managed block on uninstall", () => {
    const configPath = createKimiHome();
    fs.writeFileSync(configPath, '[providers.kimi]\ntype = "kimi"\n');

    installHook({ kimi: true, mode: "observe" });
    installHook({ kimi: true, uninstall: true });

    const config = fs.readFileSync(configPath, "utf8");
    expect(config).toContain("[providers.kimi]");
    expect(config).not.toContain("[[hooks]]");
    expect(config).not.toContain("spctre");
  });

  it("ignores --global: Kimi has no project-scoped config.toml", () => {
    const configPath = createKimiHome();
    createWorkspace();

    installHook({ kimi: true, mode: "observe", global: false });

    expect(fs.existsSync(configPath)).toBe(true);
  });
});

describe("Kimi Code skill installation", () => {
  it("installs the project skill into .kimi-code/skills/, a scanned directory", async () => {
    const workspace = createWorkspace();

    await installSkill({ kimi: true });

    expect(fs.existsSync(path.join(workspace, ".kimi-code", "skills", "spctre", "SKILL.md"))).toBe(
      true,
    );
  });

  it("installs the user skill under the Kimi data root", async () => {
    createKimiHome();
    createWorkspace();

    await installSkill({ kimi: true, global: true });

    expect(
      fs.existsSync(
        path.join(process.env.KIMI_CODE_HOME as string, "skills", "spctre", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("activates through AGENTS.md, the instruction file Kimi reads", async () => {
    const workspace = createWorkspace();
    const agentsPath = path.join(workspace, ".kimi-code", "AGENTS.md");
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(agentsPath, "# Project\n");

    await installSkill({ kimi: true });

    expect(fs.readFileSync(agentsPath, "utf8")).toContain(".kimi-code/skills/spctre");
  });
});
