import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { bundleExport, bundlePreview, bundleVerify } from "../src/bundle-export";

let tmpDir: string;

describe("bundle export", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-cli-export-"));
    process.env.SPCTRE_CONFIG_DIR = path.join(tmpDir, ".spctre");
    fs.mkdirSync(process.env.SPCTRE_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.SPCTRE_CONFIG_DIR, "config.json"),
      JSON.stringify({
        controlPlaneUrl: "https://control.test",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        workspaceSlug: "workspace",
        agentId: "agent-1",
        environment: "production",
        token: "token-1",
        tokenId: "token-id",
        tokenExpiresAt: "2999-01-01T00:00:00.000Z",
        artifactHash: "sha256:artifact",
        branchId: "branch-1",
        revisionId: "revision-1",
        bundlePath: "spctre-policy.json",
        policyContext: [],
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.SPCTRE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes target artifact and manifest sidecar", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        headers: new Headers({ "x-spctre-export-verified": "true" }),
        json: async () => ({
          artifact: "package spctre.policy\n",
          manifest: {
            format: "opa-rego",
            artifactHash: "sha256:artifact",
            compiledArtifactHash: "sha256:compiled",
            blockingWarnings: [],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const output = path.join(tmpDir, "policy.rego");
    const manifestOutput = path.join(tmpDir, "policy.manifest.json");
    const result = await bundleExport({ format: "opa-rego", output, manifestOutput, quiet: true });

    expect(result).toEqual({ outputPath: output, manifestPath: manifestOutput, verified: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://control.test/api/v1/bundle/latest?workspace=workspace-1&format=opa-rego",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
      }),
    );
    expect(fs.readFileSync(output, "utf8")).toBe("package spctre.policy\n");
    expect(JSON.parse(fs.readFileSync(manifestOutput, "utf8"))).toMatchObject({
      format: "opa-rego",
      artifactHash: "sha256:artifact",
    });
  });

  it("previews all target export manifests without writing artifacts", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      json: async () => ({
        formats: [
          { format: "opa-rego", blockingWarnings: [] },
          {
            format: "cedar",
            blockingWarnings: ["Cedar cannot enforce ESCALATE semantics for rule r-1."],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await bundlePreview({ output: "json" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://control.test/api/v1/bundle/latest?workspace=workspace-1&preview=true",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
      }),
    );
    expect(rows).toEqual([
      { format: "opa-rego", ok: true, blockingWarnings: [] },
      {
        format: "cedar",
        ok: false,
        blockingWarnings: ["Cedar cannot enforce ESCALATE semantics for rule r-1."],
      },
    ]);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ formats: rows }, null, 2));
  });

  it("exits in strict preview mode when any target is blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        json: async () => ({
          formats: [
            { format: "opa-rego", blockingWarnings: [] },
            { format: "cedar", blockingWarnings: ["blocked"] },
          ],
        }),
      }),
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await bundlePreview({ strict: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when the server blocks the target export", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 409,
          statusText: "Conflict",
          headers: new Headers({ "x-spctre-export-verified": "false" }),
          json: async () => ({
            error: "Bundle export blocked because target semantics could not be preserved.",
            manifest: {
              blockingWarnings: ["Cedar cannot enforce ESCALATE semantics for rule r-1."],
            },
          }),
        }),
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await bundleExport({ format: "cedar", output: path.join(tmpDir, "policy.cedar"), quiet: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Cedar cannot enforce ESCALATE semantics"),
    );
  });

  it("verifies a local artifact against its manifest", async () => {
    const artifact = "package spctre.policy\n";
    const artifactPath = path.join(tmpDir, "policy.rego");
    const manifestPath = path.join(tmpDir, "policy.rego.manifest.json");
    fs.writeFileSync(artifactPath, artifact);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        format: "opa-rego",
        target: "Open Policy Agent Rego policy",
        compatibilityLevel: "NATIVE",
        semanticWarnings: [],
        blockingWarnings: [],
        verificationTargets: ["opa check"],
        artifactHash: "sha256:artifact",
        compiledArtifactHash: `sha256:${createHash("sha256").update(artifact).digest("hex")}`,
        generatedAt: "2026-07-05T00:00:00.000Z",
        provenance: {
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          branchId: "branch-1",
          revisionId: "revision-1",
          sourceHash: "sha256:source",
          sourceFormat: "SPCTRE_MANAGED",
          targetStacks: [],
        },
        ruleCount: 1,
      }),
    );

    const result = await bundleVerify({ artifact: artifactPath, manifest: manifestPath });

    expect(result).toEqual({ ok: true, issues: [] });
    expect(console.log).toHaveBeenCalledWith("Bundle export verification: PASS");
    expect(console.log).toHaveBeenCalledWith("  - opa check");
  });

  it("exits non-zero when local artifact verification fails", async () => {
    const artifactPath = path.join(tmpDir, "policy.rego");
    const manifestPath = path.join(tmpDir, "policy.rego.manifest.json");
    fs.writeFileSync(artifactPath, "package spctre.policy\n# tampered\n");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        format: "opa-rego",
        target: "Open Policy Agent Rego policy",
        compatibilityLevel: "NATIVE",
        semanticWarnings: [],
        blockingWarnings: [],
        verificationTargets: ["opa check"],
        artifactHash: "sha256:artifact",
        compiledArtifactHash: `sha256:${createHash("sha256").update("package spctre.policy\n").digest("hex")}`,
        generatedAt: "2026-07-05T00:00:00.000Z",
        provenance: {
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          branchId: "branch-1",
          revisionId: "revision-1",
          sourceHash: "sha256:source",
          sourceFormat: "SPCTRE_MANAGED",
          targetStacks: [],
        },
        ruleCount: 1,
      }),
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    await bundleVerify({ artifact: artifactPath, manifest: manifestPath });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.log).toHaveBeenCalledWith("Bundle export verification: FAIL");
    expect(console.log).toHaveBeenCalledWith("  - Compiled artifact hash does not match manifest.");
  });
});
