import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type SkillHarness = "claude" | "codex" | "gemini" | "antigravity";

interface SkillHarnessConfig {
  displayName: string;
  baseDir: (global: boolean | undefined) => string;
  activationFile: string | null;
  activationNeedle: string;
}

const HARNESS_CONFIG: Record<SkillHarness, SkillHarnessConfig> = {
  claude: {
    displayName: "Claude Code",
    baseDir: (global) =>
      global ? path.join(os.homedir(), ".claude") : path.join(process.cwd(), ".claude"),
    activationFile: "CLAUDE.md",
    activationNeedle: ".claude/skills/spctre",
  },
  codex: {
    displayName: "Codex",
    baseDir: (global) =>
      global
        ? path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
        : path.join(process.cwd(), ".codex"),
    activationFile: "AGENTS.md",
    activationNeedle: ".codex/skills/spctre",
  },
  gemini: {
    displayName: "Gemini CLI",
    baseDir: (global) =>
      global
        ? path.join(process.env.GEMINI_HOME ?? path.join(os.homedir(), ".gemini"))
        : path.join(process.cwd(), ".gemini"),
    activationFile: "GEMINI.md",
    activationNeedle: ".gemini/skills/spctre",
  },
  antigravity: {
    // Workspace skills in .agents/skills/ are auto-read by the Antigravity IDE
    // and the agy CLI. Global installs use agy's staged plugin directory.
    displayName: "Antigravity (IDE + agy CLI)",
    baseDir: (global) =>
      global
        ? path.join(os.homedir(), ".gemini", "antigravity-cli", "plugins", "spctre")
        : path.join(process.cwd(), ".agents"),
    activationFile: null,
    activationNeedle: "",
  },
};

interface InstallSkillOptions {
  claude?: boolean;
  codex?: boolean;
  gemini?: boolean;
  antigravity?: boolean;
  global?: boolean;
  harness?: SkillHarness | "agy";
  force?: boolean;
}

export async function installSkill(options: InstallSkillOptions) {
  const harness = parseHarness(options);
  const config = HARNESS_CONFIG[harness];
  const skillSource = path.join(__dirname, "..", "skill", "SKILL.md");
  if (!fs.existsSync(skillSource)) {
    console.error("Error: bundled SKILL.md not found. Try reinstalling @spctre/cli.");
    process.exit(1);
  }

  const baseDir = config.baseDir(options.global);

  const skillDir = path.join(baseDir, "skills", "spctre");
  const skillDest = path.join(skillDir, "SKILL.md");

  if (harness === "antigravity" && options.global) {
    ensureAntigravityPlugin(baseDir);
  }

  if (fs.existsSync(skillDest) && !options.force) {
    console.log(`Skill already installed at ${skillDest}`);
    console.log("Run with --force to overwrite.");
    return;
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(skillSource, skillDest);

  if (!config.activationFile) {
    console.log(`Spctre skill installed for ${config.displayName} → ${skillDest}`);
    if (harness === "antigravity") {
      console.log("");
      if (options.global) {
        console.log(
          "Installed into agy's staged plugin directory (auto-discovered by the agy CLI).",
        );
        console.log(
          "The Antigravity IDE's global skills directory is ~/.gemini/antigravity/skills/ if you also want it there.",
        );
      } else {
        console.log(
          "Workspace skills in .agents/skills/ are auto-read by the Antigravity IDE and agy CLI.",
        );
      }
    }
    return;
  }

  const activationPath = path.join(baseDir, config.activationFile);
  const activation = [
    "# spctre",
    `- **spctre** (\`${skillDest}\`) — policy governance for agent actions`,
    "Before any governed external action (connector calls, deployments, database writes,",
    "external messages), invoke the Spctre policy skill at the path above.",
  ].join("\n");

  console.log(`Spctre skill installed for ${config.displayName} → ${skillDest}`);
  console.log("");

  if (fs.existsSync(activationPath)) {
    const existing = fs.readFileSync(activationPath, "utf8");
    if (existing.includes(config.activationNeedle)) {
      console.log(`${activationPath} already references the skill — no changes made.`);
    } else {
      fs.appendFileSync(activationPath, `\n${activation}\n`);
      console.log(`Added activation entry to ${activationPath}`);
    }
  } else {
    console.log(`To activate, add this to ${activationPath}:`);
    console.log("");
    console.log(activation);
  }
}

function ensureAntigravityPlugin(pluginDir: string) {
  const manifestPath = path.join(pluginDir, "plugin.json");
  if (fs.existsSync(manifestPath)) return;

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        $schema: "https://antigravity.google/schemas/v1/plugin.json",
        name: "spctre",
        description: "Spctre policy governance for agent actions",
      },
      null,
      2,
    )}\n`,
  );
}

function parseHarness(options: InstallSkillOptions): SkillHarness {
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
