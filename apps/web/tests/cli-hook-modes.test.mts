import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHookCommand, installHook } from "../../../packages/cli/src/install-hook";
import { parseHookMode, shouldBlockDecision } from "../../../packages/cli/src/pretooluse";

let previousCwd: string;
let tempDir: string;

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function commandsFor(settings: Record<string, unknown>, hookEvent: string, group = "hooks"): string[] {
  const hooks = settings[group] as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  return (hooks[hookEvent] ?? []).flatMap((entry) => entry.hooks?.map((hook) => hook.command ?? "") ?? []);
}

describe("CLI hook adapter modes", () => {
  beforeEach(() => {
    previousCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-hook-test-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs observe mode by default", () => {
    installHook({ codex: true });

    const settings = readJson(path.join(tempDir, ".codex", "hooks.json"));
    expect(commandsFor(settings, "PreToolUse")).toContain(
      "npx @spctre/cli pretooluse --harness codex --mode observe"
    );
  });

  it("installs enforce mode when explicitly requested", () => {
    installHook({ claude: true, enforce: true });

    const settings = readJson(path.join(tempDir, ".claude", "settings.json"));
    expect(commandsFor(settings, "PreToolUse")).toContain(
      "npx @spctre/cli pretooluse --harness claude --mode enforce"
    );
  });

  it("removes legacy hook commands during uninstall", () => {
    const settingsPath = path.join(tempDir, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: ".*",
            hooks: [{ type: "command", command: "npx @spctre/cli pretooluse --harness claude" }],
          },
        ],
      },
    }));

    installHook({ claude: true, uninstall: true });

    const settings = readJson(settingsPath);
    expect(settings.hooks).toBeUndefined();
  });

  it("exposes explicit hook commands and blocking semantics", () => {
    expect(buildHookCommand("gemini", "observe")).toBe(
      "npx @spctre/cli pretooluse --harness gemini --mode observe"
    );
    expect(buildHookCommand("gemini", "enforce")).toBe(
      "npx @spctre/cli pretooluse --harness gemini --mode enforce"
    );
    expect(shouldBlockDecision("observe", "DENY")).toBe(false);
    expect(shouldBlockDecision("enforce", "DENY")).toBe(true);
    expect(shouldBlockDecision("enforce", "WARN")).toBe(false);
  });

  it("fails closed on invalid hook modes", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => parseHookMode({ mode: "enforec" as never })).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: unsupported hook mode "enforec". Expected "observe" or "enforce".'
    );

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("installs Antigravity hooks in .agents/hooks.json and supports the agy alias", () => {
    installHook({ harness: "agy" });

    const settings = readJson(path.join(tempDir, ".agents", "hooks.json"));
    expect(commandsFor(settings, "PreToolUse", "spctre")).toContain(
      "npx @spctre/cli pretooluse --harness antigravity --mode observe"
    );
  });

  it("exposes explicit hook commands and blocking semantics for antigravity", () => {
    expect(buildHookCommand("antigravity", "observe")).toBe(
      "npx @spctre/cli pretooluse --harness antigravity --mode observe"
    );
    expect(buildHookCommand("antigravity", "enforce")).toBe(
      "npx @spctre/cli pretooluse --harness antigravity --mode enforce"
    );
  });
});
