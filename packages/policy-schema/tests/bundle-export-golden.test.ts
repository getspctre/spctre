import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildPolicyBundleExport,
  toAgtCompatiblePolicyBundle,
  verifyPolicyBundleExport,
} from "../src/index";
import type { AgtCompatiblePolicyBundle, PolicyRuleSummary } from "../src/index";

const fixturePath = path.join(__dirname, "fixtures", "representative-bundle.json");
const fixtureInput = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as AgtCompatiblePolicyBundle;
const bundle = toAgtCompatiblePolicyBundle(fixtureInput);

const FIXED_GENERATED_AT = "2026-07-06T00:00:00.000Z";

describe("bundle export golden fixtures", () => {
  const formats = ["spctre-json", "opa-rego", "opa-bundle", "cedar", "mcp-proxy-config"] as const;

  for (const format of formats) {
    it(`exports ${format} cleanly with correct provenance`, () => {
      const exported = buildPolicyBundleExport({ bundle, format, generatedAt: FIXED_GENERATED_AT });

      expect(exported.ok).toBe(true);
      expect(exported.manifest.provenance.branchId).toBe("branch-fixture");
      expect(exported.manifest.provenance.revisionId).toBe("rev-fixture-001");
      expect(exported.manifest.ruleCount).toBe(3);
      expect(exported.manifest.blockingWarnings).toHaveLength(0);
      expect(exported.manifest.verificationTargets.length).toBeGreaterThan(0);

      const verification = verifyPolicyBundleExport({ artifact: exported.artifact, manifest: exported.manifest });
      expect(verification.ok).toBe(true);
      expect(verification.issues).toHaveLength(0);
    });
  }

  it("opa-rego artifact contains package declaration and condition helpers", () => {
    const exported = buildPolicyBundleExport({ bundle, format: "opa-rego", generatedAt: FIXED_GENERATED_AT });

    expect(typeof exported.artifact).toBe("string");
    const rego = exported.artifact as string;
    expect(rego).toContain("package spctre.policy");
    expect(rego).toContain("spctre_conditions_ok");
    expect(rego).toContain("branch-fixture");
    expect(exported.manifest.verificationTargets).toContain("opa check");
  });

  it("opa-bundle artifact has policy.rego and data.json with correct provenance", () => {
    const exported = buildPolicyBundleExport({ bundle, format: "opa-bundle", generatedAt: FIXED_GENERATED_AT });

    const artifact = exported.artifact as Record<string, unknown>;
    expect(typeof (artifact["policy.rego"] as string)).toBe("string");
    expect((artifact["policy.rego"] as string)).toContain("package spctre.policy");

    const data = artifact["data.json"] as { spctre: { provenance: Record<string, unknown>; rules: unknown[] } };
    expect(data.spctre.provenance.branch_id).toBe("branch-fixture");
    expect(data.spctre.rules).toHaveLength(3);
  });

  it("cedar artifact contains permit, forbid, WARN advisory comment, and entity mapping header", () => {
    const exported = buildPolicyBundleExport({ bundle, format: "cedar", generatedAt: FIXED_GENERATED_AT });

    expect(typeof exported.artifact).toBe("string");
    const cedar = exported.artifact as string;
    expect(cedar).toContain("forbid(");
    expect(cedar).toContain("permit(");
    expect(cedar).toContain("WARN — advisory");
    expect(cedar).toContain("Entity mapping:");
    expect(cedar).toContain("Principal namespace: Agent");
    expect(exported.manifest.semanticWarnings.some((w) => w.includes("WARN"))).toBe(true);
  });

  it("mcp-proxy-config artifact has correct schema and parameterConstraints on each rule", () => {
    const exported = buildPolicyBundleExport({ bundle, format: "mcp-proxy-config", generatedAt: FIXED_GENERATED_AT });

    const artifact = exported.artifact as Record<string, unknown>;
    expect(artifact.schemaVersion).toBe("spctre.mcp.proxy.config.v1");
    expect(artifact.provenance).toMatchObject({ branchId: "branch-fixture" });

    const rules = artifact.rules as Record<string, unknown>[];
    expect(rules).toHaveLength(3);
    for (const rule of rules) {
      expect(Array.isArray(rule.parameterConstraints)).toBe(true);
    }
  });

  it("mcp-proxy-config artifact exports a rule's threshold/branch guard as parameterConstraints, not conditions", () => {
    const b = toAgtCompatiblePolicyBundle({
      tenantId: "t",
      workspaceId: "w",
      branchId: "b",
      revisionId: "r",
      sourceFormat: "SPCTRE_MANAGED",
      sourceHash: "sha256:src",
      artifactHash: "sha256:art",
      targetStacks: [],
      approvals: [],
      rules: [{
        stableRuleId: "github.branch.force_push_protected.block",
        title: "Block force-pushing to a protected branch",
        effect: "DENY",
        sourceFormat: "SPCTRE_MANAGED",
        domains: ["branches"],
        connectors: ["github"],
        actions: ["branch.push"],
        immutable: true,
        conditions: [{ legacy_field: "unrelated_agt_condition" }],
        parameterConstraints: [
          { field: "ref", operator: "in", value: ["main", "master"], parameterKey: "github.protected_branches" },
          { field: "force", operator: "eq", value: true },
        ],
      }],
      generatedAt: FIXED_GENERATED_AT,
      metadata: {},
    });

    const exported = buildPolicyBundleExport({ bundle: b, format: "mcp-proxy-config", generatedAt: FIXED_GENERATED_AT });
    expect(exported.ok).toBe(true);
    const artifact = exported.artifact as { rules: Record<string, unknown>[] };
    const rule = artifact.rules.find((r) => r.id === "github.branch.force_push_protected.block")!;

    // The exported enforcement guard must be the typed parameterConstraints,
    // not the unrelated legacy AGT `conditions` blob — otherwise a proxy
    // enforcing this artifact would apply the rule unconditionally.
    expect(rule.parameterConstraints).toEqual([
      { field: "ref", operator: "in", value: ["main", "master"], parameterKey: "github.protected_branches" },
      { field: "force", operator: "eq", value: true },
    ]);
    expect(rule.rawConditions).toEqual([{ legacy_field: "unrelated_agt_condition" }]);
  });
});

describe("semantic parity", () => {
  function makeMinimalBundle(rules: PolicyRuleSummary[]): AgtCompatiblePolicyBundle {
    return toAgtCompatiblePolicyBundle({
      tenantId: "t",
      workspaceId: "w",
      branchId: "b",
      revisionId: "r",
      sourceFormat: "SPCTRE_MANAGED",
      sourceHash: "sha256:src",
      artifactHash: "sha256:art",
      targetStacks: [],
      approvals: [],
      rules,
      generatedAt: FIXED_GENERATED_AT,
      metadata: {},
    });
  }

  it("DENY rule produces forbid in Cedar", () => {
    const b = makeMinimalBundle([{
      stableRuleId: "x.deny",
      title: "Deny X",
      effect: "DENY",
      sourceFormat: "SPCTRE_MANAGED",
      domains: [],
      connectors: ["x"],
      actions: ["act"],
      immutable: false,
    }]);
    const exported = buildPolicyBundleExport({ bundle: b, format: "cedar" });
    expect(exported.ok).toBe(true);
    expect(exported.artifact as string).toContain("forbid(");
  });

  it("ALLOW rule produces permit in Cedar", () => {
    const b = makeMinimalBundle([{
      stableRuleId: "x.allow",
      title: "Allow X",
      effect: "ALLOW",
      sourceFormat: "SPCTRE_MANAGED",
      domains: [],
      connectors: ["x"],
      actions: ["act"],
      immutable: false,
    }]);
    const exported = buildPolicyBundleExport({ bundle: b, format: "cedar" });
    expect(exported.ok).toBe(true);
    expect(exported.artifact as string).toContain("permit(");
  });

  it("WARN rule emits advisory comment, not a Cedar policy statement", () => {
    const b = makeMinimalBundle([{
      stableRuleId: "x.warn",
      title: "Warn X",
      effect: "WARN",
      sourceFormat: "SPCTRE_MANAGED",
      domains: [],
      connectors: ["x"],
      actions: ["act"],
      immutable: false,
    }]);
    const exported = buildPolicyBundleExport({ bundle: b, format: "cedar" });
    expect(exported.ok).toBe(true);
    const cedar = exported.artifact as string;
    expect(cedar).toContain("WARN — advisory");
    expect(cedar).not.toContain("permit(");
    expect(cedar).not.toContain("forbid(");
  });

  it("ESCALATE rule causes Cedar export to fail closed with blocking warning", () => {
    const b = makeMinimalBundle([{
      stableRuleId: "x.escalate",
      title: "Escalate X",
      effect: "ESCALATE",
      sourceFormat: "SPCTRE_MANAGED",
      domains: [],
      connectors: ["x"],
      actions: ["act"],
      immutable: false,
    }]);
    const exported = buildPolicyBundleExport({ bundle: b, format: "cedar" });
    expect(exported.ok).toBe(false);
    expect(exported.artifact).toBeNull();
    expect(exported.manifest.blockingWarnings.some((w) => w.includes("ESCALATE"))).toBe(true);
  });
});

describe("dynamic conditions", () => {
  it("TIME_WINDOW DENY rule: OPA rego contains condition evaluation", () => {
    const b = toAgtCompatiblePolicyBundle({
      tenantId: "t",
      workspaceId: "w",
      branchId: "b",
      revisionId: "r",
      sourceFormat: "SPCTRE_MANAGED",
      sourceHash: "sha256:src",
      artifactHash: "sha256:art",
      targetStacks: [],
      approvals: [],
      rules: [{
        stableRuleId: "x.deny.window",
        title: "Deny in window",
        effect: "DENY",
        sourceFormat: "SPCTRE_MANAGED",
        domains: [],
        connectors: ["x"],
        actions: ["act"],
        immutable: false,
        dynamicConditions: [{
          kind: "TIME_WINDOW",
          source: "AGT_CONDITION",
          window: { start_hour: 9, end_hour: 17 },
          originalCondition: { type: "time_window", start_hour: 9, end_hour: 17 },
        }],
      }],
      generatedAt: FIXED_GENERATED_AT,
      metadata: {},
    });

    const exported = buildPolicyBundleExport({ bundle: b, format: "opa-rego" });
    expect(exported.ok).toBe(true);
    const rego = exported.artifact as string;
    expect(rego).toContain("spctre_conditions_ok");
    expect(rego).toContain("TIME_WINDOW");
  });

  it("TIME_WINDOW DENY rule: MCP proxy config export is blocked", () => {
    const b = toAgtCompatiblePolicyBundle({
      tenantId: "t",
      workspaceId: "w",
      branchId: "b",
      revisionId: "r",
      sourceFormat: "SPCTRE_MANAGED",
      sourceHash: "sha256:src",
      artifactHash: "sha256:art",
      targetStacks: [],
      approvals: [],
      rules: [{
        stableRuleId: "x.deny.window",
        title: "Deny in window",
        effect: "DENY",
        sourceFormat: "SPCTRE_MANAGED",
        domains: [],
        connectors: ["x"],
        actions: ["act"],
        immutable: false,
        dynamicConditions: [{
          kind: "TIME_WINDOW",
          source: "AGT_CONDITION",
          window: { start_hour: 9, end_hour: 17 },
          originalCondition: { type: "time_window", start_hour: 9, end_hour: 17 },
        }],
      }],
      generatedAt: FIXED_GENERATED_AT,
      metadata: {},
    });

    const exported = buildPolicyBundleExport({ bundle: b, format: "mcp-proxy-config" });
    expect(exported.ok).toBe(false);
    expect(exported.manifest.blockingWarnings.some((w) => w.includes("TIME_WINDOW"))).toBe(true);
  });

  it("TIME_WINDOW ALLOW rule: MCP proxy config export succeeds (non-blocking advisory)", () => {
    const b = toAgtCompatiblePolicyBundle({
      tenantId: "t",
      workspaceId: "w",
      branchId: "b",
      revisionId: "r",
      sourceFormat: "SPCTRE_MANAGED",
      sourceHash: "sha256:src",
      artifactHash: "sha256:art",
      targetStacks: [],
      approvals: [],
      rules: [{
        stableRuleId: "x.allow.window",
        title: "Allow in window",
        effect: "ALLOW",
        sourceFormat: "SPCTRE_MANAGED",
        domains: [],
        connectors: ["x"],
        actions: ["act"],
        immutable: false,
        dynamicConditions: [{
          kind: "TIME_WINDOW",
          source: "AGT_CONDITION",
          window: { start_hour: 9, end_hour: 17 },
          originalCondition: { type: "time_window", start_hour: 9, end_hour: 17 },
        }],
      }],
      generatedAt: FIXED_GENERATED_AT,
      metadata: {},
    });

    const exported = buildPolicyBundleExport({ bundle: b, format: "mcp-proxy-config" });
    expect(exported.ok).toBe(true);
    expect(exported.manifest.blockingWarnings).toHaveLength(0);
    const rules = (exported.artifact as Record<string, unknown>).rules as Record<string, unknown>[];
    expect(rules[0].advisoryDynamicConditions).toHaveLength(1);
  });
});

describe("native verifier invocation", () => {
  const opaAvailable = (() => {
    try {
      const r = spawnSync("opa", ["version"], { encoding: "utf8", timeout: 5000 });
      return r.status === 0;
    } catch {
      return false;
    }
  })();

  const cedarAvailable = (() => {
    try {
      const r = spawnSync("cedar", ["--version"], { encoding: "utf8", timeout: 5000 });
      return r.status === 0;
    } catch {
      return false;
    }
  })();

  it.skipIf(!opaAvailable)("opa check passes on exported opa-rego artifact", () => {
    const exported = buildPolicyBundleExport({ bundle, format: "opa-rego", generatedAt: FIXED_GENERATED_AT });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-opa-golden-"));
    const regoPath = path.join(tmpDir, "policy.rego");
    fs.writeFileSync(regoPath, exported.artifact as string);
    try {
      const result = spawnSync("opa", ["check", regoPath], { encoding: "utf8", timeout: 10000 });
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!cedarAvailable)("cedar validate passes on exported cedar artifact", () => {
    const exported = buildPolicyBundleExport({ bundle, format: "cedar", generatedAt: FIXED_GENERATED_AT });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spctre-cedar-golden-"));
    const cedarPath = path.join(tmpDir, "policy.cedar");
    fs.writeFileSync(cedarPath, exported.artifact as string);
    try {
      const result = spawnSync("cedar", ["validate", cedarPath], { encoding: "utf8", timeout: 10000 });
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("opa check skipped when opa is not available", () => {
    if (!opaAvailable) {
      expect(true).toBe(true);
    } else {
      expect(opaAvailable).toBe(true);
    }
  });
});
