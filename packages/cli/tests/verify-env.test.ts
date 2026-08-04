import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpctreCliConfig } from "../src/config";
import { writeLangChainAdapter } from "../src/frameworks/langchain";
import { verifyEnv } from "../src/verify-env";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

const config: SpctreCliConfig = {
  workspaceId: "ws-verify",
  agentId: "agent-verify",
  token: "test-token",
  controlPlaneUrl: "https://spctre.test",
  environment: "test",
  artifactHash: "hash-verify",
  policyContext: [
    {
      scope: "WORKSPACE",
      branchId: "branch-verify",
      revisionId: "rev-verify",
      artifactHash: "hash-verify",
    },
  ],
};

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("verify-env", () => {
  it("verifies that the generated LangChain adapter patched the imported framework", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-verify-env-"));
    tempDirs.push(tempDir);
    process.chdir(tempDir);

    fs.mkdirSync(path.join(tempDir, "langchain_core"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "langchain_core", "__init__.py"), "", "utf8");
    fs.writeFileSync(
      path.join(tempDir, "langchain_core", "tools.py"),
      "class BaseTool:\n    def invoke(self, input, config=None, **kwargs):\n        return input\n    async def ainvoke(self, input, config=None, **kwargs):\n        return input\n",
      "utf8",
    );

    writeLangChainAdapter(config);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    verifyEnv({ framework: "langchain", python: "python3" });

    expect(logSpy).toHaveBeenCalledWith(
      "Governance active: langchain adapter is installed and patched.",
    );
  });
});
