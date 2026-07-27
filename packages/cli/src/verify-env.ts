import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const SPCTRE_DIR = ".spctre";
const WRAPPER_FILENAME = "spctre-python";
const ADAPTER_FILENAME = "sitecustomize.py";
const MANIFEST_FILENAME = "governance-manifest.json";

type VerifyFramework =
  | "crewai"
  | "langchain"
  | "langgraph"
  | "openai-agents"
  | "openai_agents"
  | "autogen"
  | "google-adk"
  | "google_adk"
  | "antigravity-sdk"
  | "antigravity_sdk"
  | "google-antigravity"
  | "google_antigravity"
  | "claude-agent-sdk"
  | "claude_agent_sdk"
  | "strands"
  | "notion-worker"
  | "notion_worker"
  | "omnigent";

const supportedFrameworks = new Set<VerifyFramework>([
  "crewai",
  "langchain",
  "langgraph",
  "openai-agents",
  "openai_agents",
  "autogen",
  "google-adk",
  "google_adk",
  "antigravity-sdk",
  "antigravity_sdk",
  "google-antigravity",
  "google_antigravity",
  "claude-agent-sdk",
  "claude_agent_sdk",
  "strands",
  "notion-worker",
  "notion_worker",
  "omnigent",
]);

export function verifyEnv(options: { framework?: string; python?: string }) {
  const framework = normalizeFramework(options.framework);

  // Notion Worker uses a JS template, not a Python sitecustomize adapter.
  if (framework === "notion-worker" || framework === "notion_worker") {
    verifyNotionWorkerAdapter();
    return;
  }

  // Omnigent uses a native policy module, not a sitecustomize adapter or wrapper.
  if (framework === "omnigent") {
    verifyOmnigentAdapter(options.python ?? "python");
    return;
  }

  const python = options.python ?? "python";
  const spctreDir = path.resolve(process.cwd(), SPCTRE_DIR);
  const wrapperPath = path.join(spctreDir, WRAPPER_FILENAME);
  const adapterPath = path.join(spctreDir, ADAPTER_FILENAME);
  const manifestPath = path.join(spctreDir, MANIFEST_FILENAME);

  if (!fs.existsSync(adapterPath) || !fs.existsSync(wrapperPath) || !fs.existsSync(manifestPath)) {
    console.error(`Error: .spctre adapter files were not found. Run "spctre watch --framework ${framework}" first.`);
    process.exit(1);
  }
  verifyManifest({ manifestPath, framework, spctreDir, adapterPath, wrapperPath });

  const result = spawnSync(wrapperPath, [python, "-c", buildVerificationSnippet(framework)], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SPCTRE_KEY: process.env.SPCTRE_KEY ?? "",
      SPCTRE_API_TOKEN: process.env.SPCTRE_API_TOKEN ?? "",
    },
  });

  if (result.error) {
    console.error(`Error: could not run ${wrapperPath}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    console.error(output || `Error: ${framework} governance verification failed.`);
    process.exit(result.status ?? 1);
  }

  const output = result.stdout.trim();
  if (output) console.log(output);
}

function verifyNotionWorkerAdapter() {
  const spctreDir = path.resolve(process.cwd(), SPCTRE_DIR);
  const workerPath = path.join(spctreDir, "notion-worker.js");
  const manifestPath = path.join(spctreDir, "governance-manifest-notion-worker.json");

  if (!fs.existsSync(workerPath) || !fs.existsSync(manifestPath)) {
    console.error(`Error: .spctre/notion-worker.js was not found. Run "spctre watch --framework notion-worker" first.`);
    process.exit(1);
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      framework?: string;
      files?: { workerSha256?: string };
    };
    if (manifest.framework !== "notion-worker") {
      console.error(`Error: governance manifest is for "${manifest.framework ?? "unknown"}", not "notion-worker".`);
      process.exit(1);
    }
    if (manifest.files?.workerSha256 !== sha256File(workerPath)) {
      console.error("Error: .spctre/notion-worker.js does not match governance-manifest-notion-worker.json. Re-run spctre watch --framework notion-worker.");
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: could not read Notion Worker governance manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log("Governance active: Notion Worker template is present and matches governance manifest.");
  console.log("Deploy with: notion worker deploy .spctre/notion-worker.js");
}

function verifyOmnigentAdapter(python: string) {
  const spctreDir = path.resolve(process.cwd(), SPCTRE_DIR);
  const policyPath = path.join(spctreDir, "spctre_policy.py");
  const manifestPath = path.join(spctreDir, "governance-manifest-omnigent.json");

  if (!fs.existsSync(policyPath) || !fs.existsSync(manifestPath)) {
    console.error(`Error: .spctre/spctre_policy.py was not found. Run "spctre watch --framework omnigent" first.`);
    process.exit(1);
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      framework?: string;
      files?: { policySha256?: string };
    };
    if (manifest.framework !== "omnigent") {
      console.error(`Error: governance manifest is for "${manifest.framework ?? "unknown"}", not "omnigent".`);
      process.exit(1);
    }
    if (manifest.files?.policySha256 !== sha256File(policyPath)) {
      console.error("Error: .spctre/spctre_policy.py does not match governance-manifest-omnigent.json. Re-run spctre watch --framework omnigent.");
      process.exit(1);
    }
    const spctreMode = fs.statSync(spctreDir).mode;
    if ((spctreMode & 0o022) !== 0) {
      console.error("Error: .spctre is group/world writable. Re-run spctre watch --framework omnigent to restore safe permissions.");
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: could not read Omnigent governance manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const result = spawnSync(python, ["-c", `
import importlib
import asyncio
import inspect
import sys

module = importlib.import_module("spctre_policy")
factory = getattr(module, "spctre_policy", None)
if not callable(factory):
    print("Governance inactive: spctre_policy.spctre_policy is not callable.", file=sys.stderr)
    sys.exit(1)

policy = factory(emit_evidence=False)
if not callable(policy):
    print("Governance inactive: spctre_policy factory did not return a callable.", file=sys.stderr)
    sys.exit(1)
if not inspect.iscoroutinefunction(policy):
    print("Governance inactive: spctre_policy factory should return an async callable.", file=sys.stderr)
    sys.exit(1)

result = asyncio.run(policy({"type": "message", "target": "not_a_tool", "data": {}}))
if result is not None:
    print("Governance inactive: non-tool Omnigent events should return None to abstain.", file=sys.stderr)
    sys.exit(1)
`.trim()], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: `${spctreDir}${process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ""}`,
      SPCTRE_KEY: process.env.SPCTRE_KEY ?? "",
      SPCTRE_API_TOKEN: process.env.SPCTRE_API_TOKEN ?? "",
    },
  });

  if (result.error) {
    console.error(`Error: could not run ${python}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    console.error(output || "Error: Omnigent governance verification failed.");
    process.exit(result.status ?? 1);
  }

  console.log("Governance active: Omnigent spctre_policy module is present and matches governance manifest.");
  console.log("Verified native Omnigent async policy factory import and abstain behavior.");
  console.log("Verify that server_config.yaml lists 'spctre_policy' under policy_modules and that SPCTRE_API_TOKEN or SPCTRE_KEY is set at runtime.");
}

function verifyManifest(params: {
  manifestPath: string;
  framework: VerifyFramework;
  spctreDir: string;
  adapterPath: string;
  wrapperPath: string;
}) {
  try {
    const manifest = JSON.parse(fs.readFileSync(params.manifestPath, "utf8")) as {
      framework?: string;
      runtimePatching?: boolean;
      patchTargets?: unknown[];
      files?: {
        adapterSha256?: string;
        wrapperSha256?: string;
      };
    };
    const requestedFramework = params.framework.replace("_", "-") === "google-antigravity"
      ? "antigravity-sdk"
      : params.framework;
    const manifestFramework = manifest.framework === "langchain" && params.framework === "langgraph"
      ? "langgraph"
      : manifest.framework;
    if (manifestFramework !== requestedFramework.replace("_", "-")) {
      console.error(`Error: governance manifest is for "${manifest.framework ?? "unknown"}", not "${params.framework}".`);
      process.exit(1);
    }
    if (manifest.runtimePatching !== true || !manifest.patchTargets?.length) {
      console.error("Error: governance manifest does not declare runtime patch targets.");
      process.exit(1);
    }
    const spctreMode = fs.statSync(params.spctreDir).mode;
    if ((spctreMode & 0o022) !== 0) {
      console.error("Error: .spctre is group/world writable. Re-run spctre watch --framework to restore safe permissions.");
      process.exit(1);
    }
    if (manifest.files?.adapterSha256 !== sha256File(params.adapterPath)) {
      console.error("Error: .spctre/sitecustomize.py does not match governance-manifest.json.");
      process.exit(1);
    }
    if (manifest.files?.wrapperSha256 !== sha256File(params.wrapperPath)) {
      console.error("Error: .spctre/spctre-python does not match governance-manifest.json.");
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: could not read governance manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function sha256File(filePath: string) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function normalizeFramework(value?: string): VerifyFramework {
  const framework = (value ?? "").toLowerCase().trim() as VerifyFramework;
  if (!supportedFrameworks.has(framework)) {
    console.error("Error: --framework is required. Supported values: crewai, langchain, openai-agents, autogen, google-adk, antigravity-sdk, claude-agent-sdk, strands, notion-worker, omnigent");
    process.exit(1);
  }
  return framework;
}

function buildVerificationSnippet(framework: VerifyFramework) {
  const dashed = framework.replace("_", "-");
  const normalized = framework === "langgraph"
    ? "langchain"
    : dashed === "google-antigravity"
      ? "antigravity-sdk"
      : dashed;
  return `
import importlib
import sys

def fail(message):
    print(f"Governance inactive: {message}", file=sys.stderr)
    sys.exit(1)

def load(module_name):
    try:
        return importlib.import_module(module_name)
    except Exception as exc:
        fail(f"could not import {module_name}: {type(exc).__name__}: {exc}")

def load_any(module_names):
    errors = []
    for module_name in module_names:
        try:
            return importlib.import_module(module_name)
        except Exception as exc:
            errors.append(f"{module_name} ({type(exc).__name__}: {exc})")
    fail("could not import any supported module: " + ", ".join(errors))

def attr(obj, name, owner):
    value = getattr(obj, name, None)
    if value is None:
        fail(f"{owner}.{name} was not found")
    return value

def assert_patched(obj, owner):
    if getattr(obj, "_spctre_patched", False) is not True:
        fail(f"{owner} was imported but is not patched")

def activate_adapter():
    try:
        sitecustomize = importlib.import_module("sitecustomize")
        importlib.reload(sitecustomize)
    except Exception as exc:
        fail(f"could not load generated sitecustomize.py: {type(exc).__name__}: {exc}")

framework = ${JSON.stringify(normalized)}

if framework == "crewai":
    module = load("crewai.tools")
    activate_adapter()
    target = attr(module, "BaseTool", "crewai.tools")
    assert_patched(target, "crewai.tools.BaseTool")
elif framework == "langchain":
    module = load_any(["langchain_core.tools", "langchain.tools"])
    activate_adapter()
    target = attr(module, "BaseTool", module.__name__)
    assert_patched(target, f"{module.__name__}.BaseTool")
elif framework == "openai-agents":
    module = load("agents")
    activate_adapter()
    target = attr(module, "FunctionTool", "agents")
    assert_patched(target, "agents.FunctionTool")
elif framework == "autogen":
    try:
        module = importlib.import_module("autogen_core.tools")
        activate_adapter()
        target = attr(module, "FunctionTool", "autogen_core.tools")
        assert_patched(target, "autogen_core.tools.FunctionTool")
    except SystemExit:
        raise
    except Exception:
        module = load("autogen")
        activate_adapter()
        target = attr(module, "ConversableAgent", "autogen")
        assert_patched(target, "autogen.ConversableAgent")
elif framework == "google-adk":
    module = load_any(["google.adk.tools", "google.adk.tools.base_tool"])
    activate_adapter()
    target = attr(module, "BaseTool", module.__name__)
    assert_patched(target, f"{module.__name__}.BaseTool")
elif framework == "antigravity-sdk":
    module = load("google.antigravity.tools.tool_runner")
    activate_adapter()
    target = attr(module, "ToolRunner", module.__name__)
    assert_patched(target, f"{module.__name__}.ToolRunner")
    if __import__("os").environ.get("SPCTRE_ANTIGRAVITY_SDK_MODE", "observe").lower() == "enforce":
        agent_module = load("google.antigravity.agent")
        agent = attr(agent_module, "Agent", agent_module.__name__)
        assert_patched(agent, f"{agent_module.__name__}.Agent enforcement")
elif framework == "claude-agent-sdk":
    module = load("claude_agent_sdk")
    activate_adapter()
    target = attr(module, "ClaudeAgentOptions", "claude_agent_sdk")
    assert_patched(target, "claude_agent_sdk.ClaudeAgentOptions")
elif framework == "strands":
    try:
        module = importlib.import_module("strands.handlers.tool_handler")
        activate_adapter()
        target = attr(module, "ToolHandler", "strands.handlers.tool_handler")
        assert_patched(target, "strands.handlers.tool_handler.ToolHandler")
    except SystemExit:
        raise
    except Exception:
        module = load("strands.tools.function_tool")
        activate_adapter()
        target = attr(module, "FunctionTool", "strands.tools.function_tool")
        assert_patched(target, "strands.tools.function_tool.FunctionTool")
else:
    fail(f"unsupported framework {framework}")

print(f"Governance active: {framework} adapter is installed and patched.")
`.trim();
}
