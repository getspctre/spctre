import { describe, it, expect } from "vitest";
import { buildComplianceFrameworkAnnotation } from "../src/index";

const base = {
  approvalCount: 3,
  evidenceCount: 120,
  deniedDecisionCount: 8,
  warnedDecisionCount: 14,
  escalationCount: 4,
  resolvedEscalationCount: 3,
  artifactHash: "sha256:abcdef1234567890",
  operationsEventCounts: {
    EVIDENCE_INGEST: 120,
    POLICY_PUBLISH: 2,
    POLICY_IMPORT: 5,
    POLICY_APPROVE: 3,
    TOKEN_ISSUED: 6,
    TOKEN_REVOKED: 1,
    IDENTITY_CHANGE: 9,
    VERIFICATION_RUN: 2,
    COMPLIANCE_EXPORT: 3,
    ESCALATION_RESOLVED: 3,
  },
  generatedAt: "2026-05-08T12:00:00Z",
};

// ---------------------------------------------------------------------------
// SOC2
// ---------------------------------------------------------------------------
describe("buildComplianceFrameworkAnnotation — SOC2", () => {
  it("returns correct frameworkLabel", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "soc2" });
    expect(ann.framework).toBe("soc2");
    expect(ann.frameworkLabel).toMatch(/SOC 2/i);
  });

  it("includes expected control IDs", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "soc2" });
    const ids = ann.controls.map((c) => c.controlId);
    expect(ids).toContain("CC6.1");
    expect(ids).toContain("CC6.6");
    expect(ids).toContain("CC7.2");
    expect(ids).toContain("CC4.1");
  });

  it("marks CC6.6 as ADDRESSED when denied decisions exist", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "soc2" });
    const cc66 = ann.controls.find((c) => c.controlId === "CC6.6")!;
    expect(cc66.status).toBe("ADDRESSED");
  });

  it("marks CC6.6 as PARTIAL when no denied decisions", () => {
    const ann = buildComplianceFrameworkAnnotation({
      ...base,
      framework: "soc2",
      deniedDecisionCount: 0,
    });
    const cc66 = ann.controls.find((c) => c.controlId === "CC6.6")!;
    expect(cc66.status).toBe("PARTIAL");
  });

  it("marks CC7.3 as NOT_APPLICABLE when no escalations", () => {
    const ann = buildComplianceFrameworkAnnotation({
      ...base,
      framework: "soc2",
      escalationCount: 0,
    });
    const cc73 = ann.controls.find((c) => c.controlId === "CC7.3")!;
    expect(cc73.status).toBe("NOT_APPLICABLE");
  });

  it("summary counts are consistent with controls", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "soc2" });
    const total = ann.summary.addressedCount + ann.summary.partialCount + ann.summary.notApplicableCount;
    expect(total).toBe(ann.controls.length);
  });

  it("includes generatedAt", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "soc2" });
    expect(ann.generatedAt).toBe(base.generatedAt);
  });
});

// ---------------------------------------------------------------------------
// EU AI Act
// ---------------------------------------------------------------------------
describe("buildComplianceFrameworkAnnotation — EU AI Act", () => {
  it("returns correct frameworkLabel", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "eu-ai-act" });
    expect(ann.frameworkLabel).toMatch(/EU AI Act/i);
  });

  it("includes expected article IDs", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "eu-ai-act" });
    const ids = ann.controls.map((c) => c.controlId);
    expect(ids).toContain("Art.9");
    expect(ids).toContain("Art.13");
    expect(ids).toContain("Art.14");
    expect(ids).toContain("Art.17");
  });

  it("marks Art.14 as ADDRESSED when resolved escalations exist", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "eu-ai-act" });
    const art14 = ann.controls.find((c) => c.controlId === "Art.14")!;
    expect(art14.status).toBe("ADDRESSED");
  });

  it("marks Art.14 as NOT_APPLICABLE when no escalations at all", () => {
    const ann = buildComplianceFrameworkAnnotation({
      ...base,
      framework: "eu-ai-act",
      escalationCount: 0,
      resolvedEscalationCount: 0,
    });
    const art14 = ann.controls.find((c) => c.controlId === "Art.14")!;
    expect(art14.status).toBe("NOT_APPLICABLE");
  });

  it("marks Art.17 as PARTIAL when no approvals", () => {
    const ann = buildComplianceFrameworkAnnotation({
      ...base,
      framework: "eu-ai-act",
      approvalCount: 0,
    });
    const art17 = ann.controls.find((c) => c.controlId === "Art.17")!;
    expect(art17.status).toBe("PARTIAL");
  });

  it("summary counts are consistent with controls", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "eu-ai-act" });
    const total = ann.summary.addressedCount + ann.summary.partialCount + ann.summary.notApplicableCount;
    expect(total).toBe(ann.controls.length);
  });
});

// ---------------------------------------------------------------------------
// HIPAA
// ---------------------------------------------------------------------------
describe("buildComplianceFrameworkAnnotation — HIPAA", () => {
  it("returns correct frameworkLabel", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "hipaa" });
    expect(ann.frameworkLabel).toMatch(/HIPAA/i);
  });

  it("includes expected section IDs", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "hipaa" });
    const ids = ann.controls.map((c) => c.controlId);
    expect(ids).toContain("§164.312(b)");
    expect(ids).toContain("§164.312(a)(1)");
    expect(ids).toContain("§164.308(a)(1)");
    expect(ids).toContain("§164.312(e)(1)");
  });

  it("marks transmission security as ADDRESSED regardless of inputs", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "hipaa" });
    const e1 = ann.controls.find((c) => c.controlId === "§164.312(e)(1)")!;
    expect(e1.status).toBe("ADDRESSED");
  });

  it("marks audit controls as ADDRESSED when evidence ingest events exist", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "hipaa" });
    const b = ann.controls.find((c) => c.controlId === "§164.312(b)")!;
    expect(b.status).toBe("ADDRESSED");
  });

  it("marks audit controls as PARTIAL when no evidence ingest events", () => {
    const ann = buildComplianceFrameworkAnnotation({
      ...base,
      framework: "hipaa",
      operationsEventCounts: {},
    });
    const b = ann.controls.find((c) => c.controlId === "§164.312(b)")!;
    expect(b.status).toBe("PARTIAL");
  });

  it("summary counts are consistent with controls", () => {
    const ann = buildComplianceFrameworkAnnotation({ ...base, framework: "hipaa" });
    const total = ann.summary.addressedCount + ann.summary.partialCount + ann.summary.notApplicableCount;
    expect(total).toBe(ann.controls.length);
  });
});
