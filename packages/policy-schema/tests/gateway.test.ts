import { describe, it, expect } from "vitest";
import { evaluateGatewayDecision, buildAgtVerificationEvidencePacket } from "../src/index";
import type { GatewayDecisionInput } from "../src/index";

const base: GatewayDecisionInput = {
  decisionId: "dec-001",
  artifactHash: "hash-abc",
  policyContext: [
    {
      scope: "ORGANIZATION",
      branchId: "branch-1",
      revisionId: "rev-1",
      artifactHash: "hash-abc",
    },
  ],
};

// ---------------------------------------------------------------------------
// evaluateGatewayDecision — outcome coverage
// ---------------------------------------------------------------------------
describe("evaluateGatewayDecision", () => {
  describe("PROCEED outcomes", () => {
    it("proceeds for a minimal low-risk input", () => {
      const result = evaluateGatewayDecision(base);
      expect(result.outcome).toBe("PROCEED");
      expect(result.riskLevel).toBe("LOW");
      expect(result.shouldQueue).toBe(false);
    });

    it("proceeds when consequence and sensitivity are absent", () => {
      const result = evaluateGatewayDecision({ ...base, confidence: 0.95, trustScore: 0.9 });
      expect(result.outcome).toBe("PROCEED");
    });

    it("proceeds for a small financial amount below threshold", () => {
      const result = evaluateGatewayDecision({ ...base, amountUsd: 9999 });
      expect(result.outcome).toBe("PROCEED");
    });
  });

  describe("ESCALATE outcomes", () => {
    it("escalates for HIGH consequence", () => {
      const result = evaluateGatewayDecision({ ...base, consequence: "HIGH" });
      expect(result.outcome).toBe("ESCALATE");
      expect(result.riskLevel).toBe("HIGH");
      expect(result.shouldQueue).toBe(true);
      expect(result.slaHours).toBe(4);
    });

    it("escalates for CRITICAL consequence", () => {
      const result = evaluateGatewayDecision({ ...base, consequence: "CRITICAL" });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("escalates for HIGH data sensitivity", () => {
      const result = evaluateGatewayDecision({ ...base, dataSensitivity: "HIGH" });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("escalates for RESTRICTED data sensitivity", () => {
      const result = evaluateGatewayDecision({ ...base, dataSensitivity: "RESTRICTED" });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("escalates when amountUsd >= 10000", () => {
      const result = evaluateGatewayDecision({ ...base, amountUsd: 10000 });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("escalates when trustScore < 0.45", () => {
      const result = evaluateGatewayDecision({ ...base, trustScore: 0.44 });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("escalates at trust boundary (exactly 0.45 is safe)", () => {
      const result = evaluateGatewayDecision({ ...base, trustScore: 0.45 });
      expect(result.outcome).toBe("PROCEED");
    });

    it("escalates when confidence < 0.6", () => {
      const result = evaluateGatewayDecision({ ...base, confidence: 0.59 });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("escalates at confidence boundary (exactly 0.6 is safe)", () => {
      const result = evaluateGatewayDecision({ ...base, confidence: 0.6 });
      expect(result.outcome).toBe("PROCEED");
    });

    it("consequence matching is case-insensitive", () => {
      const result = evaluateGatewayDecision({ ...base, consequence: "high" });
      expect(result.outcome).toBe("ESCALATE");
    });
  });

  describe("ABORT outcomes", () => {
    it("aborts for PROHIBITED consequence", () => {
      const result = evaluateGatewayDecision({ ...base, consequence: "PROHIBITED" });
      expect(result.outcome).toBe("ABORT");
      expect(result.riskLevel).toBe("CRITICAL");
      expect(result.shouldQueue).toBe(false);
    });

    it("aborts for IRREVERSIBLE consequence", () => {
      const result = evaluateGatewayDecision({ ...base, consequence: "IRREVERSIBLE" });
      expect(result.outcome).toBe("ABORT");
      expect(result.riskLevel).toBe("CRITICAL");
    });

    it("aborts when critically low trust + high monetary amount", () => {
      const result = evaluateGatewayDecision({
        ...base,
        trustScore: 0.19,
        amountUsd: 50000,
      });
      expect(result.outcome).toBe("ABORT");
    });

    it("does not abort at trust 0.2 boundary (threshold is < 0.2)", () => {
      const result = evaluateGatewayDecision({
        ...base,
        trustScore: 0.2,
        amountUsd: 50000,
      });
      expect(result.outcome).toBe("ESCALATE");
    });

    it("aborts when critically low trust + RESTRICTED sensitivity", () => {
      const result = evaluateGatewayDecision({
        ...base,
        trustScore: 0.1,
        dataSensitivity: "RESTRICTED",
      });
      expect(result.outcome).toBe("ABORT");
    });

    it("abort takes precedence over escalate conditions", () => {
      const result = evaluateGatewayDecision({
        ...base,
        consequence: "PROHIBITED",
        confidence: 0.1,
        amountUsd: 5000,
      });
      expect(result.outcome).toBe("ABORT");
    });

    it("consequence matching is case-insensitive for abort", () => {
      const result = evaluateGatewayDecision({ ...base, consequence: "prohibited" });
      expect(result.outcome).toBe("ABORT");
    });
  });
});

// ---------------------------------------------------------------------------
// buildAgtVerificationEvidencePacket — escalation provenance
// ---------------------------------------------------------------------------
describe("buildAgtVerificationEvidencePacket", () => {
  const bundle = {
    schemaVersion: "spctre/v1" as const,
    tenantId: "t-1",
    workspaceId: "ws-1",
    branchId: "branch-1",
    revisionId: "rev-1",
    sourceFormat: "AGT_YAML",
    sourceHash: "sha256:test",
    targetStacks: [],
    artifactHash: "hash-abc",
    generatedAt: "2026-01-01T00:00:00Z",
    approvals: [{ reviewer: "user-1", role: "Security", status: "APPROVED" as const, reviewedAt: "2026-01-01T00:00:00Z" }],
    rules: [],
    metadata: {},
  } as Parameters<typeof buildAgtVerificationEvidencePacket>[0]["bundle"];

  it("includes escalationCount: 0 when no escalations passed", () => {
    const packet = buildAgtVerificationEvidencePacket({
      bundle,
      evidence: [],
      generatedAt: "2026-01-01T00:00:00Z",
    });
    expect(packet.provenance.escalationCount).toBe(0);
    expect(packet.escalations).toEqual([]);
  });

  it("includes escalations and correct count in provenance", () => {
    const escalations = [
      {
        id: "esc-1",
        decisionId: "dec-1",
        artifactHash: "hash-abc",
        resolutionOutcome: "PROCEED" as const,
        resolvedAt: "2026-01-01T01:00:00Z",
      },
      {
        id: "esc-2",
        decisionId: "dec-2",
        artifactHash: "hash-abc",
        resolutionOutcome: "ABORT" as const,
        resolutionNote: "policy violated",
        resolvedAt: "2026-01-01T02:00:00Z",
      },
    ];

    const packet = buildAgtVerificationEvidencePacket({
      bundle,
      evidence: [],
      generatedAt: "2026-01-01T00:00:00Z",
      escalations,
    });

    expect(packet.provenance.escalationCount).toBe(2);
    expect(packet.escalations).toHaveLength(2);
    expect(packet.escalations[1].resolutionOutcome).toBe("ABORT");
    expect(packet.escalations[1].resolutionNote).toBe("policy violated");
  });
});
