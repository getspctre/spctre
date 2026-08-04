import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installHook } from "../src/install-hook";
import { installSkill } from "../src/install-skill";

const originalCwd = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createWorkspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-antigravity-plugin-"));
  temporaryDirectories.push(directory);
  process.chdir(directory);
  return directory;
}

describe("Antigravity workspace installation", () => {
  it("installs the skill into .agents/skills/, auto-read by the IDE and agy CLI", async () => {
    const workspace = createWorkspace();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await installSkill({ antigravity: true });

    expect(fs.existsSync(path.join(workspace, ".agents", "skills", "spctre", "SKILL.md"))).toBe(
      true,
    );
    // No plugin bundle for workspace installs — bare .agents/ customizations
    // are auto-read without `agy plugin install`.
    expect(fs.existsSync(path.join(workspace, ".agents", "plugins"))).toBe(false);
  });

  it("installs the hook into .agents/hooks.json with the Antigravity hooks schema", () => {
    const workspace = createWorkspace();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    installHook({ antigravity: true, mode: "observe" });

    const hooks = JSON.parse(
      fs.readFileSync(path.join(workspace, ".agents", "hooks.json"), "utf8"),
    );
    expect(hooks.spctre.PreToolUse[0].matcher).toBe(".*");
    expect(hooks.spctre.PreToolUse[0].hooks[0].command).toContain(
      "--harness antigravity --mode observe",
    );
  });
});
