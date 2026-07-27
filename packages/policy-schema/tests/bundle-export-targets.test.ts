import { describe, expect, it } from "vitest";
import {
  buildPolicyBundleExport,
  buildPolicyBundleExports,
  buildMastraRuntimePolicyConfig,
  buildVercelAiRuntimePolicyConfig,
  buildGenkitRuntimePolicyConfig,
  buildGovernanceSdkRuntimePolicyConfig,
  buildGrcEvidenceBridgeDelivery,
  buildComplianceEvidenceExport,
  buildGatewayPayloadEvidence,
  createGenkitMiddleware,
  createGovernanceSdkMiddleware,
  createMastraMiddleware,
  createVercelAiMiddleware,
  createMastraBeforeToolCallHook,
  wrapGenkitToolExecute,
  wrapGovernanceSdkToolExecute,
  wrapVercelAiToolExecute,
  SpctreToolDeniedError,
  deliverGrcEvidenceBridge,
  validatePolicyControlMappings,
  toAgtCompatiblePolicyBundle,
  verifyPolicyBundleExport,
} from "../src/index";
import type { AgtCompatiblePolicyBundle, PolicyRuleSummary } from "../src/index";

const baseRules: PolicyRuleSummary[] = [
  {
    stableRuleId: "github.repo.block_delete",
    title: "Block repository deletion",
    effect: "DENY",
    sourceFormat: "SPCTRE_MANAGED",
    domains: ["source-control"],
    connectors: ["github"],
    actions: ["repo.delete"],
    immutable: false,
  },
  {
    stableRuleId: "github.repo.allow_read",
    title: "Allow repository reads",
    effect: "ALLOW",
    sourceFormat: "SPCTRE_MANAGED",
    domains: ["source-control"],
    connectors: ["github"],
    actions: ["repo.read"],
    immutable: false,
  },
];

function makeBundle(overrides: Partial<AgtCompatiblePolicyBundle> = {}): AgtCompatiblePolicyBundle {
  return toAgtCompatiblePolicyBundle({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    branchId: "branch-1",
    revisionId: "revision-1",
    sourceFormat: "SPCTRE_MANAGED",
    sourcePath: "policies/github.yaml",
    sourceHash: "sha256:source",
    artifactHash: "sha256:artifact",
    targetStacks: [{ stack: "LOCAL", adapter: "spctre-test", environment: "test" }],
    approvals: [{ reviewer: "security@example.com", role: "security", status: "APPROVED" }],
    rules: baseRules,
    generatedAt: "2026-07-05T00:00:00.000Z",
    metadata: { owner: "platform" },
    ...overrides,
  });
}

describe("policy bundle export targets", () => {
  it("builds a provenance-bound Mastra runtime policy configuration", () => {
    const result = buildMastraRuntimePolicyConfig(makeBundle());
    expect(result.ok).toBe(true);
    expect(result.compiledArtifactHash).toMatch(/^sha256:/);
    expect(result.artifact).toMatchObject({ schemaVersion: "spctre.mastra-policy.v1", provenance: { artifactHash: "sha256:artifact" } });
  });

  it("builds a provenance-bound Vercel AI runtime policy configuration", () => {
    const result = buildVercelAiRuntimePolicyConfig(makeBundle());
    expect(result.ok).toBe(true);
    expect(result.artifact).toMatchObject({ schemaVersion: "spctre.vercel-ai-policy.v1", provenance: { revisionId: "revision-1" } });
  });

  it("builds a provenance-bound Genkit runtime policy configuration", () => {
    expect(buildGenkitRuntimePolicyConfig(makeBundle()).artifact).toMatchObject({ schemaVersion: "spctre.genkit-policy.v1" });
  });

  it("builds a provenance-bound governance-sdk runtime policy configuration", () => {
    expect(buildGovernanceSdkRuntimePolicyConfig(makeBundle()).artifact).toMatchObject({ schemaVersion: "spctre.governance-sdk-policy.v1" });
  });

  it("installs each TypeScript runtime middleware with reviewed provenance and payload enforcement", () => {
    for (const middleware of [
      createMastraMiddleware(makeBundle()),
      createVercelAiMiddleware(makeBundle()),
      createGenkitMiddleware(makeBundle()),
      createGovernanceSdkMiddleware(makeBundle()),
    ]) {
      expect(middleware.provenance).toMatchObject({ artifactHash: "sha256:artifact", revisionId: "revision-1" });
      expect(middleware.evaluate({ connector: "github", action: "repo.delete" })).toMatchObject({
        status: "DENY",
        matchedPolicyRefs: ["github.repo.block_delete"],
      });
    }
  });

  it("creates gateway-ingest evidence with payload hash but no payload content", () => {
    const evidence = buildGatewayPayloadEvidence({
      middleware: createMastraMiddleware(makeBundle()), decisionId: "decision-1",
      call: { connector: "github", action: "repo.delete", toolParameters: { repository: "private-repo" } },
    });
    expect(evidence).toMatchObject({ ingestMode: "gateway", status: "DENY", policyRefs: ["github.repo.block_delete"] });
    expect(evidence.rawEvidence).toMatchObject({ _payload_guardrail: true, payloadHash: expect.stringMatching(/^sha256:/) });
    expect(JSON.stringify(evidence.rawEvidence)).not.toContain("private-repo");
  });

  it("binds Mastra hooks and tool executors to reviewed policy decisions", async () => {
    const bundle = makeBundle();
    const mastra = createMastraBeforeToolCallHook({ middleware: createMastraMiddleware(bundle), connector: "github", denyOutput: (result) => ({ blocked: result.reason }) });
    expect(mastra({ toolName: "repo.delete", input: {} })).toMatchObject({ proceed: false, output: { blocked: expect.any(String) } });
    const wrappers = [
      wrapVercelAiToolExecute({ middleware: createVercelAiMiddleware(bundle), connector: "github", toolName: "repo.delete", execute: async () => "ran" }),
      wrapGenkitToolExecute({ middleware: createGenkitMiddleware(bundle), connector: "github", toolName: "repo.delete", execute: async () => "ran" }),
      wrapGovernanceSdkToolExecute({ middleware: createGovernanceSdkMiddleware(bundle), connector: "github", toolName: "repo.delete", execute: async () => "ran" }),
    ];
    for (const execute of wrappers) await expect(execute({}, {})).rejects.toBeInstanceOf(SpctreToolDeniedError);
  });

  it("builds an idempotent webhook GRC delivery contract", () => {
    const artifact = {
      branchId: "branch-1", revisionId: "revision-1", artifactHash: "sha256:artifact", sourceHash: "sha256:source",
      sourceFormat: "SPCTRE_MANAGED" as const, targetStacks: [], rules: baseRules, generatedAt: "2026-07-05T00:00:00.000Z",
    };
    const packet = buildComplianceEvidenceExport({
      id: "cmp-1", artifact, readiness: { branchId: "branch-1", revisionId: "revision-1", isReady: true, status: "READY", satisfiedRoles: [], missingRoles: [], blockingReasons: [], approvals: [] },
      timeline: { branchId: "branch-1", revisionId: "revision-1", events: [] }, evidence: [], generatedAt: "2026-07-05T00:00:00.000Z", retentionDays: 30,
    });
    expect(buildGrcEvidenceBridgeDelivery({ packet, destination: { kind: "webhook", endpoint: "https://grc.example.test/evidence" } })).toMatchObject({
      schemaVersion: "spctre.grc-evidence-delivery.v1",
      idempotencyKey: "spctre:sha256:artifact:cmp-1",
      payload: { schemaVersion: "spctre.grc-evidence-bridge.v1" },
    });
  });

  it("retries transient GRC delivery failures with the same idempotency key", async () => {
    const packet = buildComplianceEvidenceExport({ id: "cmp-1", artifact: { branchId: "branch-1", revisionId: "revision-1", artifactHash: "sha256:artifact", sourceHash: "sha256:source", sourceFormat: "SPCTRE_MANAGED", targetStacks: [], rules: baseRules, generatedAt: "2026-07-05T00:00:00.000Z" }, readiness: { branchId: "branch-1", revisionId: "revision-1", isReady: true, status: "READY", satisfiedRoles: [], missingRoles: [], blockingReasons: [], approvals: [] }, timeline: { branchId: "branch-1", revisionId: "revision-1", events: [] }, evidence: [], generatedAt: "2026-07-05T00:00:00.000Z", retentionDays: 30 });
    const delivery = buildGrcEvidenceBridgeDelivery({ packet, destination: { kind: "webhook", endpoint: "https://grc.example.test/evidence" } });
    let calls = 0;
    const result = await deliverGrcEvidenceBridge({ delivery, send: async ({ headers }) => {
      calls++; expect(headers["idempotency-key"]).toBe(delivery.idempotencyKey); return { status: calls === 1 ? 503 : 202 };
    } });
    expect(result).toMatchObject({ delivered: true, attempts: [{ status: 503 }, { status: 202 }] });
  });

  it("deduplicates exported mappings and flags duplicate pack metadata", () => {
    const rules = [{ ...baseRules[0], controlMappings: [{ framework: "SOC2" as const, controlId: "CC6.1" }, { framework: "SOC2" as const, controlId: "CC6.1" }] }];
    expect(validatePolicyControlMappings(rules)).toEqual([{ stableRuleId: "github.repo.block_delete", message: "Duplicate control mapping SOC2:CC6.1." }]);
  });
  it("exports the canonical Spctre JSON bundle with provenance and manifest", () => {
    const bundle = makeBundle();
    const exported = buildPolicyBundleExport({
      bundle,
      format: "spctre-json",
      generatedAt: "2026-07-05T00:01:00.000Z",
    });

    expect(exported.ok).toBe(true);
    expect(exported.contentType).toBe("application/json");
    expect(exported.manifest).toMatchObject({
      format: "spctre-json",
      artifactHash: "sha256:artifact",
      generatedAt: "2026-07-05T00:01:00.000Z",
      provenance: {
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        branchId: "branch-1",
        revisionId: "revision-1",
        sourceHash: "sha256:source",
      },
      ruleCount: 2,
    });
    expect(exported.artifact).toMatchObject({
      schemaVersion: "spctre.bundle.export.v1",
      provenance: {
        branchId: "branch-1",
        revisionId: "revision-1",
        artifactHash: "sha256:artifact",
      },
    });
  });

  it("builds deterministic OPA bundle artifacts with data and Rego policy", () => {
    const bundle = makeBundle();
    const first = buildPolicyBundleExport({ bundle, format: "opa-bundle" });
    const second = buildPolicyBundleExport({ bundle, format: "opa-bundle" });

    expect(first.ok).toBe(true);
    expect(second.manifest.compiledArtifactHash).toBe(first.manifest.compiledArtifactHash);
    expect(first.manifest.verificationTargets).toEqual(["opa build", "opa check", "opa test"]);
    expect(first.artifact).toMatchObject({
      "data.json": {
        spctre: {
          provenance: {
            branch_id: "branch-1",
            revision_id: "revision-1",
            artifact_hash: "sha256:artifact",
          },
        },
      },
    });
    expect((first.artifact as Record<string, string>)["policy.rego"]).toContain("package spctre.policy");
  });

  it("fails Cedar export closed when escalation semantics cannot be represented", () => {
    const bundle = makeBundle({
      rules: [
        ...baseRules,
        {
          stableRuleId: "github.repo.escalate_write",
          title: "Escalate repository writes",
          effect: "ESCALATE",
          sourceFormat: "SPCTRE_MANAGED",
          domains: ["source-control"],
          connectors: ["github"],
          actions: ["repo.write"],
          immutable: false,
        },
      ],
    });

    const exported = buildPolicyBundleExport({ bundle, format: "cedar" });

    expect(exported.ok).toBe(false);
    expect(exported.artifact).toBeNull();
    expect(exported.manifest.blockingWarnings).toContain(
      "Cedar cannot enforce ESCALATE semantics for rule github.repo.escalate_write."
    );
  });

  it("fails MCP proxy export closed for unsupported blocking dynamic conditions", () => {
    const bundle = makeBundle({
      rules: [
        {
          ...baseRules[0],
          dynamicConditions: [
            {
              kind: "DAILY_SPEND_LIMIT",
              source: "AGT_CONDITION",
              field: "estimated_cost_usd",
              operator: "lte",
              value: 100,
              originalCondition: { type: "daily_spend_limit", value: 100 },
            },
          ],
        },
      ],
    });

    const exported = buildPolicyBundleExport({ bundle, format: "mcp-proxy-config" });

    expect(exported.ok).toBe(false);
    expect(exported.artifact).toBeNull();
    expect(exported.manifest.blockingWarnings).toContain(
      "mcp-proxy-config cannot enforce DAILY_SPEND_LIMIT for blocking rule github.repo.block_delete."
    );
  });

  it("blocks exports that contain secret-like material", () => {
    const bundle = makeBundle({
      metadata: { apiToken: "should-not-export" },
    });

    const exported = buildPolicyBundleExport({ bundle, format: "spctre-json" });

    expect(exported.ok).toBe(false);
    expect(exported.artifact).toBeNull();
    expect(exported.manifest.blockingWarnings).toContain(
      "Export input contains secret-like field metadata.apiToken."
    );
  });

  it("builds multiple requested target exports", () => {
    const exports = buildPolicyBundleExports({
      bundle: makeBundle(),
      formats: ["spctre-json", "opa-rego", "mcp-proxy-config"],
    });

    expect(exports.map((entry) => entry.format)).toEqual(["spctre-json", "opa-rego", "mcp-proxy-config"]);
    expect(exports.every((entry) => entry.manifest.artifactHash === "sha256:artifact")).toBe(true);
  });

  it("verifies an export artifact against its manifest hash and provenance", () => {
    const exported = buildPolicyBundleExport({
      bundle: makeBundle(),
      format: "opa-rego",
    });

    const verification = verifyPolicyBundleExport({
      artifact: exported.artifact,
      manifest: exported.manifest,
    });

    expect(verification).toMatchObject({
      ok: true,
      expectedHash: exported.manifest.compiledArtifactHash,
      actualHash: exported.manifest.compiledArtifactHash,
      issues: [],
    });
  });

  it("detects tampered artifacts during export verification", () => {
    const exported = buildPolicyBundleExport({
      bundle: makeBundle(),
      format: "opa-rego",
    });

    const verification = verifyPolicyBundleExport({
      artifact: `${exported.artifact as string}\n# tampered`,
      manifest: exported.manifest,
    });

    expect(verification.ok).toBe(false);
    expect(verification.issues).toContain("Compiled artifact hash does not match manifest.");
  });

  it("deterministic OPA rego output includes condition helpers for rules with dynamic conditions", () => {
    const bundle = makeBundle({
      rules: [
        {
          stableRuleId: "github.repo.block_delete_window",
          title: "Block repository deletion in business hours",
          effect: "DENY",
          sourceFormat: "SPCTRE_MANAGED",
          domains: ["source-control"],
          connectors: ["github"],
          actions: ["repo.delete"],
          immutable: false,
          dynamicConditions: [
            {
              kind: "TIME_WINDOW",
              source: "AGT_CONDITION",
              window: { start_hour: 9, end_hour: 17 },
              originalCondition: { type: "time_window", start_hour: 9, end_hour: 17 },
            },
          ],
        },
      ],
    });

    const exported = buildPolicyBundleExport({ bundle, format: "opa-rego" });

    expect(exported.ok).toBe(true);
    expect(typeof exported.artifact).toBe("string");
    const rego = exported.artifact as string;
    expect(rego).toContain("spctre_conditions_ok");
    expect(rego).toContain("TIME_WINDOW");
    expect(rego).toContain("hour_of_day");
  });

  it("reports blocked exports as unverifiable handoff artifacts", () => {
    const exported = buildPolicyBundleExport({
      bundle: makeBundle({ metadata: { apiToken: "should-not-export" } }),
      format: "spctre-json",
    });

    const verification = verifyPolicyBundleExport({
      artifact: exported.artifact,
      manifest: exported.manifest,
    });

    expect(verification.ok).toBe(false);
    expect(verification.issues).toEqual(
      expect.arrayContaining([
        "Export manifest contains blocking warnings.",
        "Export artifact is missing.",
      ])
    );
  });
});
