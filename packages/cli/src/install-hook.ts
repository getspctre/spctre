import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type HookHarness = "claude" | "codex" | "gemini" | "antigravity";
export type HookMode = "observe" | "enforce";
type HarnessConfig = (typeof HARNESS_CONFIG)[HookHarness];

const HARNESS_CONFIG: Record<
  HookHarness,
  {
    displayName: string;
    settingsPath: (global: boolean | undefined) => string;
    hookEvent: "PreToolUse" | "BeforeTool";
    settingsKey: "hooks" | "spctre";
    governedTools: string;
  }
> = {
  claude: {
    displayName: "Claude Code",
    settingsPath: (global) =>
      global
        ? path.join(os.homedir(), ".claude", "settings.json")
        : path.join(process.cwd(), ".claude", "settings.json"),
    hookEvent: "PreToolUse",
    settingsKey: "hooks",
    governedTools: "WebFetch, Bash, MCP",
  },
  codex: {
    displayName: "Codex",
    settingsPath: (global) =>
      global
        ? path.join(os.homedir(), ".codex", "hooks.json")
        : path.join(process.cwd(), ".codex", "hooks.json"),
    hookEvent: "PreToolUse",
    settingsKey: "hooks",
    governedTools: "shell/Bash tool calls",
  },
  gemini: {
    displayName: "Gemini CLI",
    settingsPath: (global) =>
      global
        ? path.join(process.env.GEMINI_HOME ?? path.join(os.homedir(), ".gemini"), "settings.json")
        : path.join(process.cwd(), ".gemini", "settings.json"),
    hookEvent: "BeforeTool",
    settingsKey: "hooks",
    governedTools: "tool calls",
  },
  antigravity: {
    // Bare hooks.json in the customization directory is auto-read by both the
    // Antigravity IDE and the agy CLI — no plugin staging required.
    displayName: "Antigravity (IDE + agy CLI)",
    settingsPath: (global) =>
      global
        ? path.join(os.homedir(), ".gemini", "config", "hooks.json")
        : path.join(process.cwd(), ".agents", "hooks.json"),
    hookEvent: "PreToolUse",
    settingsKey: "spctre",
    governedTools: "tool calls",
  },
};

interface InstallHookOptions {
  claude?: boolean;
  codex?: boolean;
  gemini?: boolean;
  antigravity?: boolean;
  global?: boolean;
  harness?: HookHarness | "agy";
  mode?: HookMode;
  enforce?: boolean;
  uninstall?: boolean;
}

export function installHook(options: InstallHookOptions) {
  const harness = parseHarness(options);
  const mode = parseHookMode(options);
  const config = HARNESS_CONFIG[harness];
  const settingsPath = config.settingsPath(options.global);
  const command = buildHookCommand(harness, mode);

  if (options.uninstall) {
    removeHook(settingsPath, config);
    return;
  }

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      console.error(`Error: could not parse ${settingsPath}`);
      process.exit(1);
    }
  }

  const hooks = (settings[config.settingsKey] ?? {}) as Record<string, unknown[]>;
  const hookEntries = (hooks[config.hookEvent] ?? []) as unknown[];
  const hookEntry = buildHookEntry(command);

  // Idempotent: skip if the entry is already present
  const entryJson = JSON.stringify(hookEntry);
  if (hookEntries.some((h) => JSON.stringify(h) === entryJson)) {
    console.log(`Hook already installed in ${settingsPath}`);
    return;
  }

  hooks[config.hookEvent] = [
    ...hookEntries.filter(
      (h) =>
        !((h as { hooks?: Array<{ command?: string }> }).hooks ?? []).some((e) =>
          commandMatches(e.command, config),
        ),
    ),
    hookEntry,
  ];
  settings[config.settingsKey] = hooks;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  console.log(`Spctre hook installed → ${settingsPath}`);
  console.log("");
  console.log(`Mode: ${mode}`);
  console.log(`On every governed ${config.displayName} tool call this local harness adapter will:`);
  console.log(`  • Send evidence for governed actions (${config.governedTools})`);
  console.log("  • Evaluate the action against your policy bundle");
  console.log(
    mode === "enforce"
      ? "  • Block on DENY, warn on WARN, pass-through on ALLOW"
      : "  • Warn locally on DENY/WARN and never block tool execution",
  );
  console.log("  • Exit immediately (no network calls) for ungoverned/internal tools");
  if (harness === "antigravity") {
    console.log("");
    console.log(
      "Antigravity reads this hooks.json automatically (IDE and agy CLI) — no plugin staging required.",
    );
  }
  if (harness === "codex") {
    console.log("");
    console.log(
      "Codex skips untrusted hooks: open Codex and run /hooks to review and trust the Spctre hook before it takes effect.",
    );
    console.log(
      "(Trust is recorded against the hook definition's hash, so re-installing with different flags requires re-trusting.)",
    );
  }
}

function parseHarness(options: InstallHookOptions): HookHarness {
  const selectedFlags = [options.claude, options.codex, options.gemini, options.antigravity].filter(
    Boolean,
  ).length;
  if (selectedFlags > 1) {
    console.error(
      'Error: choose only one harness flag: "--claude", "--codex", "--gemini", or "--antigravity".',
    );
    process.exit(1);
  }
  if (options.claude) return "claude";
  if (options.codex) return "codex";
  if (options.gemini) return "gemini";
  if (options.antigravity) return "antigravity";

  const harness = options.harness;
  if (!harness) return "claude";
  if (
    harness === "claude" ||
    harness === "codex" ||
    harness === "gemini" ||
    harness === "antigravity"
  )
    return harness;
  if (harness === "agy") return "antigravity";
  console.error(
    `Error: unsupported harness "${harness}". Expected "claude", "codex", "gemini", or "antigravity".`,
  );
  process.exit(1);
}

function parseHookMode(options: InstallHookOptions): HookMode {
  if (options.enforce) return "enforce";
  if (!options.mode) return "observe";
  if (options.mode === "observe" || options.mode === "enforce") return options.mode;
  console.error(`Error: unsupported hook mode "${options.mode}". Expected "observe" or "enforce".`);
  process.exit(1);
}

export function buildHookCommand(harness: HookHarness, mode: HookMode = "observe"): string {
  return `npx @spctre/cli pretooluse --harness ${harness} --mode ${mode}`;
}

function buildHookEntry(command: string) {
  return { matcher: ".*", hooks: [{ type: "command", command }] };
}

function commandMatches(command: string | undefined, config: HarnessConfig) {
  if (!command) return false;
  const harnesses: HookHarness[] = ["claude", "codex", "gemini", "antigravity"];
  const modeCommands = harnesses.flatMap((harness) => [
    buildHookCommand(harness, "observe"),
    buildHookCommand(harness, "enforce"),
  ]);
  const agyCommands = [
    buildHookCommand("antigravity", "observe").replace("antigravity", "agy"),
    buildHookCommand("antigravity", "enforce").replace("antigravity", "agy"),
  ];
  return (
    modeCommands.includes(command) ||
    agyCommands.includes(command) ||
    command === "npx @spctre/cli pretooluse" ||
    command === "npx @spctre/cli pretooluse --harness claude" ||
    command === "npx @spctre/cli pretooluse --harness codex" ||
    command === "npx @spctre/cli pretooluse --harness gemini" ||
    command === "npx @spctre/cli pretooluse --harness antigravity" ||
    command === "npx @spctre/cli pretooluse --harness agy" ||
    command === "SPCTRE_HARNESS=claude npx @spctre/cli pretooluse" ||
    command === "SPCTRE_HARNESS=codex npx @spctre/cli pretooluse" ||
    command === "SPCTRE_HARNESS=gemini npx @spctre/cli pretooluse" ||
    command === "SPCTRE_HARNESS=antigravity npx @spctre/cli pretooluse" ||
    command === "SPCTRE_HARNESS=agy npx @spctre/cli pretooluse"
  );
}

function removeHook(settingsPath: string, config: HarnessConfig) {
  if (!fs.existsSync(settingsPath)) {
    console.log("Hook not installed (settings file not found).");
    return;
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    console.error(`Error: could not parse ${settingsPath}`);
    process.exit(1);
  }

  const hooks = (settings[config.settingsKey] ?? {}) as Record<string, unknown[]>;
  const hookEntries = (hooks[config.hookEvent] ?? []) as unknown[];

  const filtered = hookEntries.filter(
    (h) =>
      !((h as { hooks?: Array<{ command?: string }> }).hooks ?? []).some((e) =>
        commandMatches(e.command, config),
      ),
  );

  if (filtered.length === hookEntries.length) {
    console.log(`Spctre hook not found in ${config.hookEvent} — nothing to remove.`);
    return;
  }

  if (filtered.length === 0) {
    delete hooks[config.hookEvent];
  } else {
    hooks[config.hookEvent] = filtered;
  }

  if (Object.keys(hooks).length === 0) {
    delete settings[config.settingsKey];
  } else {
    settings[config.settingsKey] = hooks;
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`Spctre hook removed from ${settingsPath}`);
}
