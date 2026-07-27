import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { SpctreCliConfig } from "../config";

const ADAPTER_FILENAME = "sitecustomize.py";
const WRAPPER_FILENAME = "spctre-python";
const MANIFEST_FILENAME = "governance-manifest.json";
const AUDIT_NOTE_FILENAME = "GOVERNANCE.md";
const SPCTRE_DIR = ".spctre";

interface AdapterTemplateOptions {
  framework: string;
  templateName: string;
}

export function writePythonAdapterFromTemplate(
  config: SpctreCliConfig,
  options: AdapterTemplateOptions,
): { adapterPath: string; launchHint: string } {
  const spctreDir = path.resolve(process.cwd(), SPCTRE_DIR);
  fs.mkdirSync(spctreDir, { recursive: true });
  const adapterPath = path.join(spctreDir, ADAPTER_FILENAME);
  const wrapperPath = path.join(spctreDir, WRAPPER_FILENAME);
  const manifestPath = path.join(spctreDir, MANIFEST_FILENAME);
  const auditNotePath = path.join(spctreDir, AUDIT_NOTE_FILENAME);

  const pythonSource = renderPythonTemplate(options.templateName, {
    FRAMEWORK: options.framework,
    CONTROL_PLANE_URL: config.controlPlaneUrl,
    TOKEN: config.token,
    WORKSPACE_ID: config.workspaceId,
    AGENT_ID: config.agentId,
    ENVIRONMENT: config.environment,
    ARTIFACT_HASH: config.artifactHash,
    POLICY_CONTEXT_JSON: JSON.stringify(config.policyContext ?? []),
  });
  const wrapperSource = renderWrapperScript();
  const manifest = buildGovernanceManifest(config, options, pythonSource, wrapperSource);

  fs.writeFileSync(adapterPath, pythonSource, "utf8");
  fs.writeFileSync(wrapperPath, wrapperSource, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(wrapperPath, 0o755);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(auditNotePath, renderAuditNote(options.framework), "utf8");
  fs.chmodSync(spctreDir, 0o700);
  fs.chmodSync(adapterPath, 0o600);
  fs.chmodSync(manifestPath, 0o600);
  fs.chmodSync(auditNotePath, 0o600);

  const launchHint = `${SPCTRE_DIR}/${WRAPPER_FILENAME} python your_agent.py`;
  return { adapterPath, launchHint };
}

// Embedded Python program: verifies .spctre file hashes against the manifest
// before any framework code runs.
const INTEGRITY_CHECK_PY = `import hashlib
import json
import os
import stat
import sys

script_dir, adapter_path, wrapper_path, manifest_path = sys.argv[1:5]

def digest(path):
    with open(path, "rb") as handle:
        return "sha256:" + hashlib.sha256(handle.read()).hexdigest()

try:
    mode = os.stat(script_dir).st_mode
    if mode & (stat.S_IWGRP | stat.S_IWOTH):
        print("bad-perms")
        sys.exit(0)
    with open(manifest_path, "r", encoding="utf8") as handle:
        manifest = json.load(handle)
    files = manifest.get("files", {})
    if files.get("adapterSha256") != digest(adapter_path):
        print("bad-adapter")
        sys.exit(0)
    if files.get("wrapperSha256") != digest(wrapper_path):
        print("bad-wrapper")
        sys.exit(0)
    print("ok")
except Exception:
    print("bad-manifest")`;

// Embedded Python program: confirms the framework patch is active (per
// framework) before handing control to the agent process.
const PREFLIGHT_PY = `import importlib
import json
import sys

manifest_path = sys.argv[1]

def fail(message):
    print(message)
    sys.exit(0)

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

try:
    with open(manifest_path, "r", encoding="utf8") as handle:
        framework = json.load(handle).get("framework")
except Exception as exc:
    fail(f"could not read governance manifest: {type(exc).__name__}: {exc}")

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
    fail(f"unsupported governance framework {framework}")

print("ok")`;

function renderWrapperScript() {
  return `#!/usr/bin/env sh
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MANIFEST="$SCRIPT_DIR/${MANIFEST_FILENAME}"
ADAPTER="$SCRIPT_DIR/${ADAPTER_FILENAME}"
WRAPPER="$SCRIPT_DIR/${WRAPPER_FILENAME}"

if [ ! -f "$MANIFEST" ] || [ ! -f "$ADAPTER" ] || [ ! -f "$WRAPPER" ]; then
  echo "Spctre governance files are incomplete. Re-run spctre watch --framework." >&2
  exit 78
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 python your_agent.py [args...]" >&2
  exit 64
fi

PYTHON_BIN="$1"

for arg in "$@"; do
  case "$arg" in
    -S|-E|-I)
      echo "Spctre governance refuses Python startup flag $arg because it can bypass sitecustomize/PYTHONPATH." >&2
      exit 78
      ;;
  esac
done

if [ "$("$PYTHON_BIN" - "$SCRIPT_DIR" "$ADAPTER" "$WRAPPER" "$MANIFEST" <<'PY'
${INTEGRITY_CHECK_PY}
PY
)" != "ok" ]; then
  echo "Spctre governance integrity check failed. Re-run spctre watch --framework and inspect .spctre/governance-manifest.json." >&2
  exit 78
fi

if [ "$(PYTHONPATH="$SCRIPT_DIR\${PYTHONPATH:+:$PYTHONPATH}" SPCTRE_ADAPTER_DIR="$SCRIPT_DIR" "$PYTHON_BIN" - "$MANIFEST" <<'PY'
${PREFLIGHT_PY}
PY
)" != "ok" ]; then
  echo "Spctre governance preflight failed. The framework patch is not active; refusing to start ungoverned." >&2
  exit 78
fi

PYTHONPATH="$SCRIPT_DIR\${PYTHONPATH:+:$PYTHONPATH}" \\
SPCTRE_ADAPTER_DIR="$SCRIPT_DIR" \\
"$@"
exit $?
`;
}

function buildGovernanceManifest(
  config: SpctreCliConfig,
  options: AdapterTemplateOptions,
  pythonSource: string,
  wrapperSource: string,
) {
  return {
    schemaVersion: 1,
    generatedBy: "spctre watch --framework",
    framework: options.framework,
    runtimePatching: true,
    launchCommand: `${SPCTRE_DIR}/${WRAPPER_FILENAME} python your_agent.py`,
    adapterPath: `${SPCTRE_DIR}/${ADAPTER_FILENAME}`,
    wrapperPath: `${SPCTRE_DIR}/${WRAPPER_FILENAME}`,
    verificationCommand: `spctre verify-env --framework ${options.framework}`,
    patchTargets: patchTargetsForFramework(options.framework),
    evidenceSignals: [
      {
        action: "governance_active",
        policyRef: "system.governance_active",
        when: "emitted after the framework patch is installed",
      },
      {
        action: "<framework tool action>",
        policyRef: "<framework>.tool.<action>",
        when: "emitted around governed framework tool calls",
      },
    ],
    controlPlaneUrl: config.controlPlaneUrl,
    workspaceId: config.workspaceId,
    agentId: config.agentId,
    environment: config.environment,
    artifactHash: config.artifactHash,
    files: {
      adapterSha256: sha256(pythonSource),
      wrapperSha256: sha256(wrapperSource),
    },
    auditNotes: [
      "This project uses a generated Python sitecustomize adapter loaded by the spctre-python wrapper.",
      "Framework calls visible in application source execute through patched library methods at runtime.",
      "Evidence emission uses non-daemon worker threads so process shutdown waits for in-flight audit writes up to the request timeout.",
      "The wrapper refuses Python startup flags -S, -E, and -I because they can bypass sitecustomize or PYTHONPATH.",
      "Runtime patching is not a complete enforcement boundary if an operator can avoid the wrapper entirely; use deployment controls and missing-governance-active monitoring in production.",
      "Review .spctre/sitecustomize.py and run the verification command before relying on evidence completeness.",
    ],
  };
}

function patchTargetsForFramework(framework: string) {
  switch (framework) {
    case "crewai":
      return ["crewai.tools.BaseTool._run", "crewai.tools.BaseTool._arun"];
    case "langchain":
      return ["langchain_core.tools.BaseTool.invoke", "langchain_core.tools.BaseTool.ainvoke", "langchain.tools.BaseTool.invoke", "langchain.tools.BaseTool.ainvoke"];
    case "openai-agents":
      return ["agents.FunctionTool.on_invoke_tool"];
    case "autogen":
      return ["autogen_core.tools.FunctionTool.run_json", "autogen.ConversableAgent.execute_function"];
    case "google-adk":
      return ["google.adk.tools.BaseTool.run_async", "google.adk.tools.base_tool.BaseTool.run_async"];
    case "antigravity-sdk":
      return ["google.antigravity.tools.tool_runner.ToolRunner.execute", "google.antigravity.tools.tool_runner.ToolRunner.process_tool_calls"];
    case "claude-agent-sdk":
      return ["claude_agent_sdk.ClaudeAgentOptions.__init__", "Claude Agent SDK PreToolUse/PostToolUse/PostToolUseFailure hooks"];
    case "strands":
      return ["strands.handlers.tool_handler.ToolHandler.process", "strands.tools.function_tool.FunctionTool.__call__"];
    case "notion-worker":
      return ["spctreGoverned (inline wrapper around Notion Worker handler tool calls)"];
    default:
      return [];
  }
}

function renderAuditNote(framework: string) {
  const launchCmd = `${SPCTRE_DIR}/${WRAPPER_FILENAME} python your_agent.py`;
  return `# Spctre Governance Runtime

This directory contains the generated Spctre runtime governance layer for ${framework}.

Application source may show direct framework calls, but governed execution is launched through:

    ${launchCmd}

The wrapper prepends this directory to PYTHONPATH so Python loads ${ADAPTER_FILENAME}. The adapter patches known framework methods at runtime, emits Spctre evidence for tool calls, and emits a governance_active signal after patch installation.

Evidence emission is sent from non-daemon worker threads. This keeps governed actions off the hot path while preventing Python from abruptly terminating an in-flight audit write when the process exits.

The wrapper refuses Python startup flags \`-S\`, \`-E\`, and \`-I\` because they can bypass \`sitecustomize.py\` or \`PYTHONPATH\`. Runtime patching is still not a complete enforcement boundary if an operator can avoid the wrapper entirely; production deployments should enforce the wrapper at the supervisor/container entrypoint and alert when expected governance_active evidence is missing.

Audit checklist:

- Review ${MANIFEST_FILENAME} for patch targets, evidence signals, and file hashes.
- Review ${ADAPTER_FILENAME} for the exact Python patch logic.
- Run: spctre verify-env --framework ${framework}
- Confirm governance_active evidence is present in the control plane for the agent/runtime.
`;
}

function sha256(source: string) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function renderPythonTemplate(templateName: string, values: Record<string, string>) {
  let source = fs.readFileSync(path.join(__dirname, "templates", templateName), "utf8");
  for (const [name, value] of Object.entries(values)) {
    source = source.replaceAll(`"__SPCTRE_${name}__"`, JSON.stringify(value));
    source = source.replaceAll(`__SPCTRE_${name}__`, value);
  }
  // Every generated Python adapter reports one stable process/session identity.
  // Runtimes may override it with SPCTRE_SESSION_ID when they have a native
  // conversation/run identifier; the process fallback is stable for its life.
  source = source.replace(
    "_SPCTRE_URL =",
    "_SPCTRE_SESSION_ID = os.environ.get(\"SPCTRE_SESSION_ID\") or f\"spctre-{os.getpid()}\"\n\n_SPCTRE_URL =",
  );
  source = source.replaceAll(
    '"agentId": _SPCTRE_AGENT,',
    '"agentId": _SPCTRE_AGENT,\n        "sessionId": _SPCTRE_SESSION_ID,',
  );
  return source;
}
