import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { filterGatewayToolParameters, injectParameter, pretooluse } from "../src/pretooluse";

// Mock configuration and functions
vi.mock("../src/config", () => ({
  readConfig: () => ({
    controlPlaneUrl: "https://control.test",
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    token: "test-token",
    bundlePath: "bundle.json",
    policyContext: [],
    agentId: "agent-1",
    environment: "production",
  }),
}));

vi.mock("../src/gateway", () => ({
  resolveGatewayConfig: () => ({
    gatewayUrl: "https://gw.test",
    token: "tok-1",
    timeoutMs: 5000,
    pollIntervalMs: 2000,
    outagePolicy: "fail-closed",
  }),
  requestGatewayDecision: vi.fn(),
  pollEscalationResolution: vi.fn(),
}));

// Mock node:fs in an ESM-compatible way
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) => {
      if (typeof path === "string" && path.endsWith("bundle.json")) return true;
      return actual.existsSync(path);
    },
    readFileSync: (path: any, options?: any) => {
      if (typeof path === "string" && path.endsWith("bundle.json")) {
        return JSON.stringify({
          rules: [
            {
              stableRuleId: "rule-1",
              title: "rule 1",
              effect: "ALLOW",
              connectors: ["stripe"],
              actions: ["charge"],
              domains: ["billing"],
            },
            {
              stableRuleId: "github.branch.force_push_protected.block",
              title: "Block force-pushing to a protected branch",
              effect: "DENY",
              connectors: ["github"],
              actions: ["branch.push"],
              domains: [],
              parameterConstraints: [
                { field: "ref", operator: "in", value: ["main", "master"] },
                { field: "force", operator: "eq", value: true },
              ],
            },
          ],
        });
      }
      return actual.readFileSync(path, options);
    },
  };
});

// Import mocked gateway module to control mock values
import { requestGatewayDecision } from "../src/gateway";

describe("filterGatewayToolParameters", () => {
  it("drops transcript-shaped fields while preserving structured tool arguments", () => {
    const filtered = filterGatewayToolParameters({
      command: "gh issue create --title bug",
      prompt: "full user prompt should not leave the hook",
      messages: [{ role: "user", content: "private transcript" }],
      nested: {
        safe: true,
        chatHistory: ["private"],
        resource_id: "repo-1",
      },
      parameters: {
        SystemPrompt: "private system prompt",
        amount: 42,
      },
    });

    expect(filtered).toEqual({
      command: "gh issue create --title bug",
      nested: {
        safe: true,
        resource_id: "repo-1",
      },
      parameters: {
        amount: 42,
      },
    });
  });
});

describe("injectParameter", () => {
  it("injects a value at a simple key path and returns true", () => {
    const obj = { key: "old" };
    expect(injectParameter(obj, "key", "new")).toBe(true);
    expect(obj.key).toBe("new");
  });

  it("injects a value at a nested path using dot notation and returns true", () => {
    const obj: any = { auth: { token: "old" } };
    expect(injectParameter(obj, "auth.token", "new")).toBe(true);
    expect(obj.auth.token).toBe("new");
  });

  it("creates missing nested objects along the path and returns true", () => {
    const obj: any = {};
    expect(injectParameter(obj, "nested.path.key", "value")).toBe(true);
    expect(obj.nested.path.key).toBe("value");
  });

  it("blocks injection attempting prototype pollution and returns false", () => {
    const obj: any = {};
    expect(injectParameter(obj, "__proto__.polluted", "value")).toBe(false);
    expect(obj.__proto__.polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();

    expect(injectParameter(obj, "constructor.prototype.polluted", "value")).toBe(false);
    expect((Object.prototype as any).polluted).toBeUndefined();
  });

  it("returns false for invalid inputs", () => {
    expect(injectParameter(null, "key", "value")).toBe(false);
    expect(injectParameter({}, "", "value")).toBe(false);
  });

  it("constrains injection when connector is provided", () => {
    const obj: any = {};
    expect(injectParameter(obj, "auth.token", "token-value", "stripe")).toBe(true);
    expect(obj.auth?.token).toBe("token-value");

    expect(injectParameter(obj, "disallowed.path", "disallowed-value", "stripe")).toBe(false);
    expect(obj.disallowed).toBeUndefined();
  });
});

describe("pretooluse Hook Credential Injection", () => {
  beforeEach(() => {
    // Mock fetch for evidence/heartbeat posts
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects credential value, prints JIT notice, outputs JSON, and exits cleanly on immediate PROCEED", async () => {
    const payload = {
      tool_name: "mcp__stripe__charge",
      tool_input: {
        amount: 100,
        auth: { token: "old" },
      },
    };

    vi.spyOn(process.stdin, "on").mockImplementation((event, callback: any) => {
      if (event === "data") {
        callback(JSON.stringify(payload));
      }
      if (event === "end") {
        callback();
      }
      return process.stdin;
    });

    vi.mocked(requestGatewayDecision).mockResolvedValue({
      gatewayEnabled: true,
      mode: "enforce",
      persisted: true,
      queued: false,
      decision: {
        outcome: "PROCEED",
        reason: "allowed",
        riskLevel: "LOW",
        shouldQueue: false,
        credentialGrant: {
          credentialType: "MOCK",
          injectedParameter: "auth.token",
          credentialValue: "ephemeral-jit-token",
          expiresAt: "2026-06-04T12:00:00Z",
        },
      },
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await pretooluse({ enforce: true });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Spctre JIT: Injected ephemeral MOCK credential into parameter \"auth.token\".")
    );
    expect(stdoutSpy).toHaveBeenCalled();
    const stdoutCall = stdoutSpy.mock.calls[0][0] as string;
    const stdoutPayload = JSON.parse(stdoutCall.trim());
    expect(stdoutPayload.tool_input.auth.token).toBe("ephemeral-jit-token");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe("pretooluse offline/local parameter-constrained enforcement", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    // Gateway is configured but resolves PROCEED with no credential grant, so
    // local evaluateDecision (the offline/degraded enforcement path) is what
    // actually decides whether the action is blocked.
    vi.mocked(requestGatewayDecision).mockResolvedValue({
      gatewayEnabled: true,
      mode: "enforce",
      persisted: true,
      queued: false,
      decision: { outcome: "PROCEED", reason: "ok", riskLevel: "LOW", shouldQueue: false },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubStdin(payload: unknown) {
    vi.spyOn(process.stdin, "on").mockImplementation((event, callback: any) => {
      if (event === "data") callback(JSON.stringify(payload));
      if (event === "end") callback();
      return process.stdin;
    });
  }

  it("denies a force push to a protected branch — tool parameters now reach evaluateDecision", async () => {
    stubStdin({
      tool_name: "mcp__github__branch.push",
      tool_input: { ref: "main", force: true },
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await pretooluse({ enforce: true });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Spctre policy DENY")
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("allows a force push to a non-protected branch — the same rule does not match", async () => {
    stubStdin({
      tool_name: "mcp__github__branch.push",
      tool_input: { ref: "feature/x", force: true },
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await pretooluse({ enforce: true });

    expect(exitSpy).not.toHaveBeenCalledWith(2);
    expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("Spctre policy DENY"));
  });
});

describe("pretooluse Antigravity hook contract", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubStdin(payload: unknown) {
    vi.spyOn(process.stdin, "on").mockImplementation((event, callback: any) => {
      if (event === "data") callback(JSON.stringify(payload));
      if (event === "end") callback();
      return process.stdin;
    });
  }

  it("reads toolCall payloads and emits an allow decision JSON for ungoverned tools", async () => {
    stubStdin({ toolCall: { name: "view_file", args: { AbsolutePath: "/tmp/file.ts" } } });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await pretooluse({ harness: "antigravity" });

    const decision = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(decision).toEqual({ decision: "allow" });
  });

  it("governs Gemini CLI's run_shell_command tool name with exit-code blocking on gateway ABORT", async () => {
    stubStdin({ tool_name: "run_shell_command", tool_input: { command: "gh pr create --title x" } });
    vi.mocked(requestGatewayDecision).mockResolvedValue({
      gatewayEnabled: true,
      mode: "enforce",
      persisted: true,
      queued: false,
      decision: {
        outcome: "ABORT",
        reason: "blocked by workspace policy",
        riskLevel: "HIGH",
        shouldQueue: false,
      },
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);

    await expect(pretooluse({ harness: "gemini", enforce: true })).rejects.toThrow("exit:2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("maps run_command CommandLine to a governed connector and emits deny JSON with exit 0 on gateway ABORT", async () => {
    stubStdin({ toolCall: { name: "run_command", args: { CommandLine: "gh pr create --title x", Cwd: "/workspace" } } });
    vi.mocked(requestGatewayDecision).mockResolvedValue({
      gatewayEnabled: true,
      mode: "enforce",
      persisted: true,
      queued: false,
      decision: {
        outcome: "ABORT",
        reason: "blocked by workspace policy",
        riskLevel: "HIGH",
        shouldQueue: false,
      },
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);

    await expect(pretooluse({ harness: "antigravity", enforce: true })).rejects.toThrow("exit:0");

    const decision = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(decision).toEqual({ decision: "deny", reason: "blocked by workspace policy" });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
