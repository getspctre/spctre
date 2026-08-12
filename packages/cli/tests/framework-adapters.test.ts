import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpctreCliConfig } from "../src/config";
import { writeAutoGenAdapter } from "../src/frameworks/autogen";
import { writeCrewAiAdapter } from "../src/frameworks/crewai";
import { writeGoogleAdkAdapter } from "../src/frameworks/google-adk";
import { writeLangChainAdapter } from "../src/frameworks/langchain";
import { writeOpenAiAgentsAdapter } from "../src/frameworks/openai-agents";
import { writeStrandsAdapter } from "../src/frameworks/strands";
import { writeAntigravitySdkAdapter } from "../src/frameworks/antigravity-sdk";
import { writeClaudeAgentSdkAdapter } from "../src/frameworks/claude-agent-sdk";
import { writeOmnigentAdapter } from "../src/frameworks/omnigent";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

const config: SpctreCliConfig = {
  tenantId: "tenant-frameworks",
  workspaceId: "ws-frameworks",
  workspaceSlug: "workspace-frameworks",
  agentId: "agent-frameworks",
  token: "test-token",
  tokenId: "token-frameworks",
  tokenExpiresAt: "2099-01-01T00:00:00.000Z",
  controlPlaneUrl: "https://spctre.test",
  environment: "test",
  artifactHash: "hash-frameworks",
  branchId: "branch-frameworks",
  revisionId: "rev-frameworks",
  bundlePath: "spctre-policy.json",
  policyContext: [
    {
      scope: "WORKSPACE",
      branchId: "branch-frameworks",
      revisionId: "rev-frameworks",
      artifactHash: "hash-frameworks",
    },
  ],
};

const adapters = [
  {
    framework: "crewai",
    writer: writeCrewAiAdapter,
    expected: [
      'runtimeTarget": {"stack": "CREWAI"',
      '_framework": "crewai"',
      "crewai.tools",
      "BaseTool._arun",
      "argumentHash",
      "hashlib.sha256",
    ],
  },
  {
    framework: "langchain",
    writer: writeLangChainAdapter,
    expected: [
      "spctre-langchain-hook",
      '_framework": "langchain"',
      "BaseTool.invoke",
      "BaseTool.ainvoke",
    ],
  },
  {
    framework: "openai-agents",
    writer: writeOpenAiAgentsAdapter,
    expected: ["OPENAI_AGENTS", '_framework": "openai-agents"', "FunctionTool"],
  },
  {
    framework: "autogen",
    writer: writeAutoGenAdapter,
    expected: ["AUTOGEN", '_framework": "autogen"', "FunctionTool", "ConversableAgent"],
  },
  {
    framework: "google-adk",
    writer: writeGoogleAdkAdapter,
    expected: ["GOOGLE_ADK", '_framework": "google-adk"', "BaseTool", "run_async"],
  },
  {
    framework: "strands",
    writer: writeStrandsAdapter,
    expected: ["spctre-strands-hook", '_framework": "strands"', "ToolHandler", "FunctionTool"],
  },
  {
    framework: "antigravity-sdk",
    writer: writeAntigravitySdkAdapter,
    expected: [
      "CUSTOM",
      "spctre-antigravity-sdk-hook",
      '_framework": "antigravity-sdk"',
      "google.antigravity.tools.tool_runner",
      "ToolRunner.execute",
      "process_tool_calls",
      "Conversation.receive_steps",
      "self.total_usage",
      "llm_turn",
      "SPCTRE_ANTIGRAVITY_SDK_MODE",
      "pre_tool_call_decide",
      "/api/gateway/decide",
    ],
  },
  {
    framework: "claude-agent-sdk",
    writer: writeClaudeAgentSdkAdapter,
    expected: [
      "spctre-claude-agent-sdk-hook",
      '_framework": "claude-agent-sdk"',
      "claude_agent_sdk",
      "ClaudeAgentOptions",
      "PreToolUse",
      "PostToolUseFailure",
      "SPCTRE_CLAUDE_AGENT_SDK_MODE",
      "/api/gateway/decide",
      "permissionDecision",
    ],
  },
] as const;

afterEach(() => {
  process.chdir(originalCwd);

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("framework adapter writers", () => {
  for (const adapter of adapters) {
    it(`writes a zero-change ${adapter.framework} sitecustomize adapter and launcher`, () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `spctre-${adapter.framework}-`));
      tempDirs.push(tempDir);
      process.chdir(tempDir);

      const { adapterPath, launchHint } = adapter.writer(config);
      const source = fs.readFileSync(adapterPath, "utf8");
      const wrapperPath = path.join(tempDir, ".spctre", "spctre-python");
      const wrapper = fs.readFileSync(wrapperPath, "utf8");
      const manifestPath = path.join(tempDir, ".spctre", "governance-manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        framework: string;
        runtimePatching: boolean;
        launchCommand: string;
        verificationCommand: string;
        patchTargets: string[];
        evidenceSignals: Array<{ action: string; policyRef: string }>;
        files: { adapterSha256: string; wrapperSha256: string };
      };
      const auditNote = fs.readFileSync(path.join(tempDir, ".spctre", "GOVERNANCE.md"), "utf8");

      expect(fs.realpathSync(adapterPath)).toBe(
        fs.realpathSync(path.join(tempDir, ".spctre", "sitecustomize.py")),
      );
      const expectedLaunch = ".spctre/spctre-python python your_agent.py";
      expect(launchHint).toBe(expectedLaunch);
      expect(fs.statSync(wrapperPath).mode & 0o111).not.toBe(0);
      expect(wrapper).toContain('PYTHONPATH="$SCRIPT_DIR${PYTHONPATH:+:$PYTHONPATH}"');
      expect(wrapper).toContain('SPCTRE_ADAPTER_DIR="$SCRIPT_DIR"');
      expect(wrapper).toContain('"$@"');
      expect(wrapper).not.toContain("\nexec ");
      expect(wrapper).toContain("-S|-E|-I");
      expect(source).toContain("Auto-generated by spctre watch --framework");
      expect(source).toContain("https://spctre.test");
      expect(source).toContain("hash-frameworks");
      expect(source).toContain("/api/evidence");
      expect(source).toContain("governance_active");
      expect(source).toContain("system.governance_active");
      expect(source).toContain("import importlib");
      expect(source).toContain("importlib.import_module");
      expect(source).toContain("daemon=False");
      expect(source).not.toContain("daemon=True");
      expect(source).not.toMatch(
        /from (crewai|langchain|langchain_core|agents|autogen|autogen_core|google|strands)\b/,
      );
      expect(manifest.framework).toBe(adapter.framework);
      expect(manifest.runtimePatching).toBe(true);
      expect(manifest.launchCommand).toBe(expectedLaunch);
      expect(manifest.verificationCommand).toBe(
        `spctre verify-env --framework ${adapter.framework}`,
      );
      expect(manifest.patchTargets.length).toBeGreaterThan(0);
      expect(manifest.evidenceSignals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "governance_active",
            policyRef: "system.governance_active",
          }),
        ]),
      );
      expect(manifest.auditNotes).toEqual(
        expect.arrayContaining([
          expect.stringContaining("non-daemon worker threads"),
          expect.stringContaining("refuses Python startup flags"),
          expect.stringContaining("not a complete enforcement boundary"),
        ]),
      );
      expect(manifest.files.adapterSha256).toMatch(/^sha256:/);
      expect(manifest.files.wrapperSha256).toMatch(/^sha256:/);
      expect(auditNote).toContain("Spctre Governance Runtime");
      expect(auditNote).toContain("spctre verify-env");
      expect(auditNote).toContain("not a complete enforcement boundary");

      for (const expected of adapter.expected) {
        expect(source).toContain(expected);
      }
    });
  }

  it("launcher sets adapter environment while running the user command as a child", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-wrapper-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeFakeLangChainPackage(tempDir);
    writeLangChainAdapter(config);
    const output = execFileSync(
      path.join(tempDir, ".spctre", "spctre-python"),
      [
        "python3",
        "-c",
        "import os; print(os.environ['SPCTRE_ADAPTER_DIR']); print(os.environ['PYTHONPATH'].split(':')[0])",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");

    const expectedAdapterDir = path.join(tempDir, ".spctre");
    expect(output).toEqual([expectedAdapterDir, expectedAdapterDir]);
  });

  it("launcher refuses to run when the framework API cannot be patched", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-wrapper-incompatible-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    // Write the adapter first so .spctre/ exists, then place the incompatible stub
    // INSIDE .spctre/ — spctre-python sets PYTHONPATH="$SCRIPT_DIR:..." so .spctre/
    // comes before site-packages, making the stub visible even when sitecustomize
    // runs at Python startup (before CWD is added to sys.path).
    writeLangChainAdapter(config);
    fs.mkdirSync(path.join(tempDir, ".spctre", "langchain_core"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".spctre", "langchain_core", "__init__.py"), "", "utf8");
    fs.writeFileSync(
      path.join(tempDir, ".spctre", "langchain_core", "tools.py"),
      "class BaseTool:\n    pass\n",
      "utf8",
    );

    expect(() =>
      execFileSync(
        path.join(tempDir, ".spctre", "spctre-python"),
        ["python3", "-c", "print('should not run')"],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow(/Spctre governance preflight failed/);
  });

  it("Antigravity SDK enforcement refuses startup when its native API cannot be installed", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-antigravity-sdk-incompatible-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeAntigravitySdkAdapter(config);
    fs.mkdirSync(path.join(tempDir, ".spctre", "google", "antigravity", "tools"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(tempDir, ".spctre", "google", "__init__.py"), "", "utf8");
    fs.writeFileSync(
      path.join(tempDir, ".spctre", "google", "antigravity", "__init__.py"),
      "",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempDir, ".spctre", "google", "antigravity", "tools", "__init__.py"),
      "",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempDir, ".spctre", "google", "antigravity", "tools", "tool_runner.py"),
      "class ToolRunner:\n    async def execute(self, *args, **kwargs): pass\n    async def process_tool_calls(self, *args, **kwargs): pass\n",
      "utf8",
    );

    expect(() =>
      execFileSync(
        path.join(tempDir, ".spctre", "spctre-python"),
        ["python3", "-c", "print('should not run')"],
        {
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, SPCTRE_ANTIGRAVITY_SDK_MODE: "enforce" },
        },
      ),
    ).toThrow(/Unable to install Google Antigravity SDK enforcement/);
  });

  it("launcher refuses Python flags that bypass sitecustomize or PYTHONPATH", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-wrapper-bypass-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeFakeLangChainPackage(tempDir);
    writeLangChainAdapter(config);

    expect(() =>
      execFileSync(
        path.join(tempDir, ".spctre", "spctre-python"),
        ["python3", "-S", "-c", "print('should not run')"],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow(/bypass sitecustomize/);
  });

  it("launcher refuses to run when sitecustomize.py no longer matches the manifest", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-wrapper-tamper-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeLangChainAdapter(config);
    fs.appendFileSync(path.join(tempDir, ".spctre", "sitecustomize.py"), "\n# tampered\n", "utf8");

    expect(() =>
      execFileSync(
        path.join(tempDir, ".spctre", "spctre-python"),
        ["python3", "-c", "print('should not run')"],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow(/Spctre governance integrity check failed/);
  });

  it("CrewAI async wrapper tolerates synchronous _arun fallbacks", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-crewai-sync-arun-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeFakeCrewAiPackage(path.join(tempDir, ".spctre"), "sync");
    writeCrewAiAdapter(config);

    const output = execFileSync(
      "python3",
      [
        "-c",
        [
          "import asyncio",
          "from crewai.tools import BaseTool",
          "print(asyncio.run(BaseTool()._arun('payload')))",
        ].join("; "),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: path.join(tempDir, ".spctre"), SPCTRE_API_TOKEN: "" },
      },
    ).trim();

    expect(output).toBe("sync:payload");
  });

  it("Claude Agent SDK adapter preserves existing hooks and adds its native lifecycle hooks", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-claude-agent-sdk-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeClaudeAgentSdkAdapter(config);
    writeFakeClaudeAgentSdkPackage(path.join(tempDir, ".spctre"));

    const output = execFileSync(
      path.join(tempDir, ".spctre", "spctre-python"),
      [
        "python3",
        "-c",
        [
          "from claude_agent_sdk import ClaudeAgentOptions, HookMatcher",
          "existing = HookMatcher('Bash', [])",
          "options = ClaudeAgentOptions(hooks={'PreToolUse': [existing]})",
          "print(','.join(sorted(options.hooks)))",
          "print(len(options.hooks['PreToolUse']))",
          "print(options.hooks['PreToolUse'][0] is existing)",
        ].join("; "),
      ],
      { encoding: "utf8", env: { ...process.env, SPCTRE_KEY: "" } },
    )
      .trim()
      .split("\n");

    expect(output).toEqual(["PostToolUse,PostToolUseFailure,PreToolUse", "2", "True"]);
  });

  it("Claude Agent SDK enforcement maps gateway outcomes to native permission decisions", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-claude-agent-sdk-enforce-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeClaudeAgentSdkAdapter(config);
    writeFakeClaudeAgentSdkPackage(path.join(tempDir, ".spctre"));

    const output = execFileSync(
      path.join(tempDir, ".spctre", "spctre-python"),
      [
        "python3",
        "-c",
        [
          "import asyncio, sitecustomize",
          "from claude_agent_sdk import ClaudeAgentOptions",
          "async def check(outcome):",
          "  sitecustomize._spctre_gateway_decide = lambda *args: (outcome, 'policy result')",
          "  hook = ClaudeAgentOptions().hooks['PreToolUse'][-1].hooks[0]",
          "  return (await hook({'tool_name': 'Bash', 'tool_input': {}}, 'tool-use', {}))['hookSpecificOutput']['permissionDecision']",
          "print(asyncio.run(check('PROCEED')))",
          "print(asyncio.run(check('ESCALATE')))",
          "print(asyncio.run(check('ABORT')))",
        ].join("\n"),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, SPCTRE_CLAUDE_AGENT_SDK_MODE: "enforce", SPCTRE_API_TOKEN: "" },
      },
    )
      .trim()
      .split("\n");

    expect(output).toEqual(["allow", "ask", "deny"]);
  });
});

describe("omnigent adapter", () => {
  it("writes spctre_policy.py with governance-manifest-omnigent.json, no sitecustomize or wrapper", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-omnigent-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    const { adapterPath, launchHint } = writeOmnigentAdapter(config);
    const source = fs.readFileSync(adapterPath, "utf8");
    const manifestPath = path.join(tempDir, ".spctre", "governance-manifest-omnigent.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      framework: string;
      runtimePatching: boolean;
      patchTargets: string[];
      auditNotes: string[];
      files: { policySha256: string };
    };
    const auditNote = fs.readFileSync(path.join(tempDir, ".spctre", "GOVERNANCE.md"), "utf8");

    expect(fs.realpathSync(adapterPath)).toBe(
      fs.realpathSync(path.join(tempDir, ".spctre", "spctre_policy.py")),
    );
    expect(launchHint).toBe(
      "PYTHONPATH=./.spctre:$PYTHONPATH omnigent server --config server_config.yaml",
    );
    expect(fs.existsSync(path.join(tempDir, ".spctre", "sitecustomize.py"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, ".spctre", "spctre-python"))).toBe(false);
    expect(source).toContain("Auto-generated by spctre watch --framework");
    expect(source).toContain("https://spctre.test");
    expect(source).toContain("hash-frameworks");
    expect(source).toContain("/api/evidence");
    expect(source).toContain("/api/v1/evaluate");
    expect(source).toContain("governance_active");
    expect(source).toContain("system.governance_active");
    expect(source).toContain("spctre_policy");
    expect(source).toContain("PolicyEvent");
    expect(source).toContain("POLICY_REGISTRY");
    expect(source).toContain('"kind": "factory"');
    expect(source).toContain("async def evaluate");
    expect(source).toContain("asyncio.to_thread");
    expect(source).toContain("_spctre_emit_background(\n                connector,");
    expect(source).not.toContain("policy module imported");
    expect(source).toContain(
      '"runtimeTarget": {"stack": "OMNIGENT", "adapter": "spctre-omnigent-policy"}',
    );
    expect(source).toContain("spctre-omnigent-policy");
    expect(source).not.toContain("rule_connectors");
    expect(source).not.toContain("with open(policy_path");
    expect(manifest.framework).toBe("omnigent");
    expect(manifest.runtimePatching).toBe(false);
    expect(manifest.patchTargets).toEqual([]);
    expect(manifest.files.policySha256).toMatch(/^sha256:/);
    expect(manifest.auditNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("delegates governed tool-call decisions"),
        expect.stringContaining("return None"),
        expect.stringContaining("ESCALATE decisions map to Omnigent ASK"),
      ]),
    );
    expect(auditNote).toContain("Spctre Governance Runtime");
    expect(auditNote).toContain("spctre verify-env");
    expect(auditNote).toContain("server_config.yaml");
    expect(auditNote).toContain("policy_modules");
    expect(auditNote).toContain("SPCTRE_API_TOKEN");
  });

  it("uses native Omnigent abstain and outage semantics without local rule evaluation", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-omnigent-warn-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    writeOmnigentAdapter(config);

    const output = execFileSync(
      "python3",
      [
        "-c",
        [
          "import asyncio",
          "import inspect",
          "import spctre_policy",
          "print(isinstance(spctre_policy.POLICY_REGISTRY, list))",
          "print(spctre_policy.POLICY_REGISTRY[0]['handler'])",
          "policy = spctre_policy.spctre_policy(emit_evidence=False)",
          "print(inspect.iscoroutinefunction(policy))",
          "print(asyncio.run(policy({'type': 'message', 'target': 'not_a_tool', 'data': {}})))",
          "print(asyncio.run(policy({'type': 'tool_call', 'target': 'Bash', 'data': {'arguments': {'command': 'gh repo view'}}}))['result'])",
          "seen = []",
          "original_evaluate = spctre_policy._spctre_evaluate",
          "spctre_policy._spctre_evaluate = lambda connector, action, domains, *args: (seen.append((connector, action, domains)) or {'result': {'status': 'ALLOW'}, 'decisionId': 'decision-allow'})",
          "asyncio.run(policy({'type': 'tool_call', 'target': 'claude_code__bash', 'data': {'arguments': {'command': 'gh repo view'}}}))",
          "asyncio.run(policy({'type': 'tool_call', 'target': 'codex.web_search', 'data': {'arguments': {'query': 'docs.databricks.com'}}}))",
          "print(seen)",
          "spctre_policy._spctre_evaluate = lambda *args: {'result': {'status': 'ESCALATE', 'reason': 'needs approval', 'matchedRefs': ['policy.escalate']}, 'decisionId': 'decision-escalate'}",
          "print(asyncio.run(policy({'type': 'tool_call', 'target': 'Bash', 'data': {'arguments': {'command': 'gh repo view'}}}))['result'])",
          "spctre_policy._spctre_evaluate = original_evaluate",
          "closed = spctre_policy.spctre_policy(outage_policy='fail-closed', emit_evidence=False)",
          "print(asyncio.run(closed({'type': 'tool_call', 'target': 'Bash', 'data': {'arguments': {'command': 'gh repo view'}}}))['result'])",
        ].join("; "),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: path.join(tempDir, ".spctre"),
          SPCTRE_KEY: "",
          SPCTRE_API_TOKEN: "",
        },
      },
    )
      .trim()
      .split(/\n/);

    expect(output).toEqual([
      "True",
      "spctre_policy.spctre_policy",
      "True",
      "None",
      "ALLOW",
      "[('github', 'execute', ['vcs']), ('docs.databricks.com', 'search', ['external'])]",
      "ASK",
      "DENY",
    ]);
  });
});

function writeFakeLangChainPackage(tempDir: string) {
  fs.mkdirSync(path.join(tempDir, "langchain_core"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, "langchain_core", "__init__.py"), "", "utf8");
  fs.writeFileSync(
    path.join(tempDir, "langchain_core", "tools.py"),
    "class BaseTool:\n    def invoke(self, input, config=None, **kwargs):\n        return input\n    async def ainvoke(self, input, config=None, **kwargs):\n        return input\n",
    "utf8",
  );
}

function writeFakeCrewAiPackage(baseDir: string, mode: "sync" | "async") {
  fs.mkdirSync(path.join(baseDir, "crewai"), { recursive: true });
  fs.writeFileSync(path.join(baseDir, "crewai", "__init__.py"), "", "utf8");
  fs.mkdirSync(path.join(baseDir, "crewai", "tools"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "crewai", "tools", "__init__.py"),
    mode === "sync"
      ? "class BaseTool:\n    name = 'Fake Tool'\n    def _arun(self, value):\n        return 'sync:' + value\n"
      : "class BaseTool:\n    name = 'Fake Tool'\n    async def _arun(self, value):\n        return 'async:' + value\n",
    "utf8",
  );
}

function writeFakeClaudeAgentSdkPackage(baseDir: string) {
  fs.mkdirSync(path.join(baseDir, "claude_agent_sdk"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "claude_agent_sdk", "__init__.py"),
    "class HookMatcher:\n    def __init__(self, matcher=None, hooks=None):\n        self.matcher = matcher\n        self.hooks = hooks or []\n\nclass ClaudeAgentOptions:\n    def __init__(self, hooks=None):\n        self.hooks = hooks or {}\n",
    "utf8",
  );
}
