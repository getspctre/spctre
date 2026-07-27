import { describe, expect, it } from "vitest";
import {
  buildAgtVerificationEvidencePacket,
  parseAgtPolicyDocument,
  toAgtCompatiblePolicyBundle,
} from "@spctre/policy-schema";

// ---------------------------------------------------------------------------
// Canonical AGT v4.0.0 enterprise production policy
// Source: microsoft/agent-governance-toolkit examples/policies/production/enterprise.yaml
// ---------------------------------------------------------------------------
const enterprisePolicy = `
# Production Policy: Enterprise
# Risk profile: MEDIUM

version: "1.0"
name: enterprise-governance
description: Standard enterprise governance with escalation.

rules:
  - name: block-delete-file
    condition: {field: action, operator: eq, value: delete_file}
    action: deny
    priority: 100
    message: "File deletion is not permitted"

  - name: block-execute-code
    condition: {field: action, operator: eq, value: execute_code}
    action: deny
    priority: 100
    message: "Code execution is blocked"

  - name: block-ssh
    condition: {field: action, operator: eq, value: ssh_connect}
    action: deny
    priority: 100
    message: "SSH is not permitted"

  - name: block-ssn-leak
    condition: {field: output, operator: matches, value: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"}
    action: deny
    priority: 95
    message: "SSN pattern detected in output"

  - name: escalate-write-file
    condition: {field: action, operator: eq, value: write_file}
    action: escalate
    priority: 80
    message: "File writes require approval"

  - name: escalate-send-email
    condition: {field: action, operator: eq, value: send_email}
    action: escalate
    priority: 80
    message: "Email requires review"

  - name: escalate-deploy
    condition: {field: action, operator: eq, value: deploy}
    action: escalate
    priority: 80
    message: "Deployments require sign-off"

defaults:
  action: deny
  max_tool_calls: 50
`;

// ---------------------------------------------------------------------------
// Canonical AGT v4.0.0 financial-services policy
// Source: microsoft/agent-governance-toolkit examples/policies/production/financial.yaml
// ---------------------------------------------------------------------------
const financialPolicy = `
# Production Policy: Financial Services (SOX/PCI)
# Risk profile: HIGH

version: "1.0"
name: financial-governance
description: SOX/PCI-regulated governance with PCI data filtering.

rules:
  - name: block-pci-credit-card
    condition: {field: output, operator: matches, value: "\\\\b(?:\\\\d[ -]*?){13,16}\\\\b"}
    action: deny
    priority: 100
    message: "PCI: Credit card number detected"

  - name: block-pii-ssn
    condition: {field: output, operator: matches, value: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b"}
    action: deny
    priority: 100
    message: "PII: SSN pattern detected"

  - name: block-execute-code
    condition: {field: action, operator: eq, value: execute_code}
    action: deny
    priority: 95
    message: "Code execution prohibited"

  - name: escalate-transaction
    condition: {field: action, operator: matches, value: "transfer_|payment_|trade_"}
    action: escalate
    priority: 85
    message: "Financial transactions require compliance approval"

  - name: allow-read
    condition: {field: action, operator: matches, value: "^(read_|search_|lookup_|calculate)"}
    action: allow
    priority: 50

defaults:
  action: deny
  max_tool_calls: 30
`;

// ---------------------------------------------------------------------------
// Policy with an explicit agt: block — tests lossless-preserved path.
// Uses the v4.0.0 consolidated engine name (agent-governance-toolkit-core).
// ---------------------------------------------------------------------------
const policyWithAgtBlock = `
name: sandbox-strict-policy
version: "1.0"
defaults:
  action: allow
agt:
  engine: agent-governance-toolkit-core
  policy_formats:
    - yaml
    - opa
    - cedar
rules:
  - name: block-dangerous-tools
    description: Block destructive tool use
    condition:
      field: tool_name
      operator: in
      value:
        - execute_code
        - delete_file
    action: deny
    priority: 100
    identity:
      min_trust_score: 800
    sandbox:
      max_ring: 1
  - id: allow-web-search
    title: Allow web search
    action: web_search
    effect: allow
    connectors:
      - web
`;

// ---------------------------------------------------------------------------
// AGT v4.1.0 policy-engine provenance and dynamic conditions.
// ---------------------------------------------------------------------------
const agt410DynamicPolicy = `
name: agent-os-cost-aware-policy
version: "1.0"
metadata:
  agtVersion: "4.1.0"
  agtPoliciesVersion: "5.0.0"
agt:
  engine: agent-governance-toolkit-core
  version: "4.1.0"
  policies_version: "5.0.0"
  cedar_policy_version: "2026-06"
  policy_engine_version: "4.1.0"
rules:
  - name: block-after-hours-deploy
    condition:
      type: time_window
      field: current_time
      operator: outside
      value:
        timezone: UTC
        start: "09:00"
        end: "17:00"
    action: deny
  - name: escalate-expensive-call
    conditions:
      - field: estimated_cost_usd
        operator: gt
        value: 2.5
      - type: budget_utilization
        field: budget_utilization
        operator: gte
        value: 0.8
    action: escalate
  - name: warn-session-spend
    session_cumulative_cost_limit:
      amount_usd: 25
      window: session
    action: warn
`;

const agt410RoundTrippedDynamicPolicy = `
name: agent-os-round-tripped-policy
version: "1.0"
rules:
  - name: warn-session-spend-round-trip
    session_cumulative_cost_limit:
      amount_usd: 25
      window: session
    sessionCumulativeCostLimit:
      amountUsd: 25
      window: session
    action: warn
`;

describe("AGT v4.0.0 compatibility — enterprise production policy", () => {
  it("parses canonical enterprise policy rules with correct count and effects", () => {
    const parsed = parseAgtPolicyDocument({
      document: enterprisePolicy,
      sourcePath: "examples/policies/production/enterprise.yaml",
    });

    expect(parsed.rules).toHaveLength(7);

    const denyRules = parsed.rules.filter((r) => r.effect === "DENY");
    const escalateRules = parsed.rules.filter((r) => r.effect === "ESCALATE");
    expect(denyRules).toHaveLength(4);
    expect(escalateRules).toHaveLength(3);

    expect(denyRules.map((r) => r.stableRuleId)).toEqual(
      expect.arrayContaining(["block-delete-file", "block-execute-code", "block-ssh", "block-ssn-leak"])
    );
    expect(escalateRules.map((r) => r.stableRuleId)).toEqual(
      expect.arrayContaining(["escalate-write-file", "escalate-send-email", "escalate-deploy"])
    );
  });

  it("extracts conditions from canonical inline-object style", () => {
    const parsed = parseAgtPolicyDocument({ document: enterprisePolicy });
    const deleteRule = parsed.rules.find((r) => r.stableRuleId === "block-delete-file")!;
    expect(deleteRule.conditions).toHaveLength(1);
    expect(deleteRule.conditions![0]).toMatchObject({ field: "action", operator: "eq" });
  });

  it("has no diagnostics errors on a well-formed canonical policy", () => {
    const parsed = parseAgtPolicyDocument({ document: enterprisePolicy });
    const errors = parsed.diagnostics.filter((d) => d.severity === "ERROR");
    expect(errors).toHaveLength(0);
  });

  it("assigns NATIVE or PARTIAL_SEMANTIC_MAP compatibility to a policy with no agt: block", () => {
    const parsed = parseAgtPolicyDocument({ document: enterprisePolicy });
    expect(["NATIVE", "PARTIAL_SEMANTIC_MAP"]).toContain(parsed.compatibility?.compatibilityLevel);
    expect(parsed.compatibility?.preservedTopLevelKeys).not.toContain("agt");
  });
});

describe("AGT v4.0.0 compatibility — financial-services policy", () => {
  it("parses financial policy rules with correct effects", () => {
    const parsed = parseAgtPolicyDocument({
      document: financialPolicy,
      sourcePath: "examples/policies/production/financial.yaml",
    });

    expect(parsed.rules).toHaveLength(5);
    const denyRules = parsed.rules.filter((r) => r.effect === "DENY");
    const escalateRules = parsed.rules.filter((r) => r.effect === "ESCALATE");
    const allowRules = parsed.rules.filter((r) => r.effect === "ALLOW");
    expect(denyRules).toHaveLength(3);
    expect(escalateRules).toHaveLength(1);
    expect(allowRules).toHaveLength(1);
  });
});

describe("AGT v4.0.0 compatibility — agt: block with v4 engine name", () => {
  it("preserves agt-native fields and records v4 engine name", () => {
    const parsed = parseAgtPolicyDocument({ document: policyWithAgtBlock });

    expect(parsed.rules).toHaveLength(2);
    expect(parsed.rules[0]).toMatchObject({
      stableRuleId: "block-dangerous-tools",
      title: "Block destructive tool use",
      effect: "DENY",
      priority: 100,
    });
    expect(parsed.rules[0].preservedFields).toMatchObject({
      identity: { min_trust_score: 800 },
      sandbox: { max_ring: 1 },
    });
    expect(parsed.sourceDocument?.agt).toMatchObject({
      engine: "agent-governance-toolkit-core",
    });
    expect(parsed.compatibility).toMatchObject({
      compatibilityLevel: "LOSSLESS_PRESERVED",
      preservedTopLevelKeys: ["agt"],
    });
  });

  it("exports compatibility metadata and AGT verification evidence packets", () => {
    const parsed = parseAgtPolicyDocument({ document: policyWithAgtBlock });
    const bundle = toAgtCompatiblePolicyBundle({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      branchId: "branch-1",
      revisionId: "revision-1",
      sourceFormat: "AGT_YAML",
      sourceHash: "sha256:source",
      artifactHash: "sha256:artifact",
      targetStacks: [{ stack: "LOCAL", adapter: "agt-compatible-local" }],
      approvals: [{ reviewer: "sec@example.com", role: "security", status: "APPROVED" }],
      rules: parsed.rules,
      generatedAt: "2026-06-05T00:00:00.000Z",
      metadata: parsed.metadata,
      sourceDocument: parsed.sourceDocument,
      compatibility: parsed.compatibility,
    });

    const packet = buildAgtVerificationEvidencePacket({
      bundle,
      generatedAt: "2026-06-05T00:01:00.000Z",
      evidence: [
        {
          decisionId: "decision-1",
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          environment: "production",
          runtimeTarget: { stack: "LOCAL", adapter: "agt-compatible-local" },
          agentId: "agent-1",
          connector: "local",
          action: "execute_code",
          status: "DENY",
          reason: "Denied by block-dangerous-tools",
          policyRefs: ["block-dangerous-tools"],
          artifactHash: "sha256:artifact",
          policyContext: [
            {
              scope: "WORKSPACE",
              branchId: "branch-1",
              revisionId: "revision-1",
              artifactHash: "sha256:artifact",
            },
          ],
          latencyMs: 1,
          createdAt: "2026-06-05T00:00:30.000Z",
          rawEvidence: { tool_name: "execute_code" },
        },
      ],
    });

    expect(bundle.metadata.spctre_agt_compatibility).toMatchObject({
      verificationTargets: [
        "agt lint-policy",
        "agt verify --evidence",
        "agt verify --evidence --strict",
      ],
    });
    expect(packet).toMatchObject({
      schemaVersion: "spctre.agt.evidence.v1",
      verifier: {
        command: "agt verify --evidence",
        strictCommand: "agt verify --evidence --strict",
      },
      provenance: {
        branchId: "branch-1",
        revisionId: "revision-1",
        approvalCount: 1,
        evidenceCount: 1,
        policyRefCount: 1,
      },
    });
  });
});

describe("AGT v4.1.0 compatibility — dynamic policy conditions", () => {
  it("types time and cost-aware dynamic conditions and records policy-engine provenance", () => {
    const parsed = parseAgtPolicyDocument({
      document: agt410DynamicPolicy,
      sourcePath: "examples/policies/production/agent-os-cost-aware.yaml",
    });

    expect(parsed.rules).toHaveLength(3);
    expect(parsed.rules.flatMap((rule) => rule.dynamicConditions ?? []).map((condition) => condition.kind)).toEqual(
      expect.arrayContaining([
        "TIME_WINDOW",
        "PER_CALL_COST_LIMIT",
        "BUDGET_UTILIZATION_THRESHOLD",
        "SESSION_CUMULATIVE_COST_LIMIT",
      ])
    );
    expect(parsed.compatibility).toMatchObject({
      agtVersion: "4.1.0",
      agtPoliciesVersion: "5.0.0",
      cedarPolicyVersion: "2026-06",
      policyEngineVersion: "4.1.0",
      compatibilityCheckOutcome: "WARN",
      dynamicConditionCount: 4,
    });
  });

  it("exports v4.1.0 provenance and ProofOfOutcome escrow fields in verification packets", () => {
    const parsed = parseAgtPolicyDocument({ document: agt410DynamicPolicy });
    const bundle = toAgtCompatiblePolicyBundle({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      branchId: "branch-1",
      revisionId: "revision-1",
      sourceFormat: "AGT_YAML",
      sourceHash: "sha256:source",
      artifactHash: "sha256:artifact",
      targetStacks: [{ stack: "CREWAI", adapter: "agt-compatible-crewai" }],
      approvals: [],
      rules: parsed.rules,
      generatedAt: "2026-06-10T00:00:00.000Z",
      metadata: parsed.metadata,
      sourceDocument: parsed.sourceDocument,
      compatibility: parsed.compatibility,
    });

    const packet = buildAgtVerificationEvidencePacket({
      bundle,
      evidence: [],
      generatedAt: "2026-06-10T00:01:00.000Z",
      verificationResults: [
        {
          id: "vr-1",
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          artifactHash: "sha256:artifact",
          verificationType: "AGT_VERIFY_EVIDENCE",
          outcome: "PASS",
          summary: {},
          runBy: "svc-ci",
          runtimeVersion: "4.1.0",
          createdAt: "2026-06-10T00:00:30.000Z",
          agtVersion: "4.1.0",
          agtPoliciesVersion: "5.0.0",
          cedarPolicyVersion: "2026-06",
          policyEngineVersion: "4.1.0",
          compatibilityCheckedAt: "2026-06-10T00:00:30.000Z",
          compatibilityCheckOutcome: "PASS",
          escrowSignerId: "did:example:escrow",
          escrowKeyId: "key-1",
          outcomeHash: "sha256:outcome",
          escrowSignature: "ed25519:signature",
          escrowVerificationOutcome: "PASS",
          escrowVerifiedAt: "2026-06-10T00:00:31.000Z",
        },
      ],
    });

    expect(bundle.metadata.spctre_agt_compatibility).toMatchObject({
      agtVersion: "4.1.0",
      agtPoliciesVersion: "5.0.0",
      cedarPolicyVersion: "2026-06",
      policyEngineVersion: "4.1.0",
    });
    expect(packet.verificationResults?.[0]).toMatchObject({
      escrowSignerId: "did:example:escrow",
      escrowVerificationOutcome: "PASS",
      agtPoliciesVersion: "5.0.0",
    });
  });

  it("deduplicates snake/camel native dynamic condition aliases", () => {
    const parsed = parseAgtPolicyDocument({ document: agt410RoundTrippedDynamicPolicy });
    const rule = parsed.rules[0];

    expect(rule.originalRule).toMatchObject({
      session_cumulative_cost_limit: { amount_usd: 25 },
      sessionCumulativeCostLimit: { amountUsd: 25 },
    });
    expect(rule.dynamicConditions?.map((condition) => condition.kind)).toEqual([
      "SESSION_CUMULATIVE_COST_LIMIT",
    ]);
    expect(parsed.compatibility?.dynamicConditionCount).toBe(1);
  });
});
