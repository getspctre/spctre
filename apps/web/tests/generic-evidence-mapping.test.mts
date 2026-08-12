import { describe, expect, it } from "vitest";
import {
  normalizeGenericEvidence,
  sourceContentHash,
  validateEvidenceMapping,
} from "../lib/domains/evidence/generic-mapping";

describe("generic evidence mapping", () => {
  const mapping = {
    occurred_at: "$.timestamp",
    action: "$.tool.name",
    source_event_id: "$.id",
    enforcement_decision: { path: "$.decision", transform: "lowercase" },
    principal_id: "$.actor.id",
  };

  it("normalizes declared fields while preserving the source payload", () => {
    const payload = {
      id: "evt-1",
      timestamp: "2026-08-11T12:00:00Z",
      tool: { name: "filesystem.write" },
      decision: "ALLOW",
      actor: { id: "user-1" },
      vendor_only: true,
    };
    expect(normalizeGenericEvidence(payload, mapping)).toMatchObject({
      sourceEventId: "evt-1",
      action: "filesystem.write",
      enforcementDecision: "allow",
      principalId: "user-1",
      sourceAttributes: payload,
    });
  });

  it("uses a stable source hash independent of object key order", () => {
    expect(sourceContentHash({ a: 1, b: { c: true } })).toBe(
      sourceContentHash({ b: { c: true }, a: 1 }),
    );
  });

  it("converts numeric occurred_at mappings from Unix epoch milliseconds", () => {
    expect(
      normalizeGenericEvidence(
        { timestamp: "1723464000000", tool: { name: "filesystem.write" } },
        { ...mapping, occurred_at: { path: "$.timestamp", transform: "number" } },
      ).occurredAt,
    ).toBe("2024-08-12T12:00:00.000Z");
  });

  it("rejects executable mapping expressions and missing baseline fields", () => {
    expect(() => validateEvidenceMapping({ ...mapping, action: "$.tool()" })).toThrow();
    expect(() => normalizeGenericEvidence({ timestamp: "2026-08-11T12:00:00Z" }, mapping)).toThrow(
      "action is required",
    );
  });
});
