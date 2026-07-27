import { describe, expect, it } from "vitest";
import {
  buildOperationsContentHash,
  validateOperationsLogChain,
} from "../src/index";

describe("operations integrity", () => {
  it("builds deterministic sha256-prefixed hashes", () => {
    const input = {
      eventType: "EVIDENCE_INGEST",
      sourceId: "ev-42",
      sourceTable: "runtime_evidence_event",
      actorId: "svc-1",
      payload: { status: "ALLOW", nested: { b: 2, a: 1 } },
      prevHash: "sha256:previous",
    };

    expect(buildOperationsContentHash(input)).toBe(buildOperationsContentHash(input));
    expect(buildOperationsContentHash(input)).toBe("sha256:a19a83ee12d8df3f1fc7b5228b17278a63b03eade7a2a216ecdb7681f44bf9ad");
  });

  it("detects content and prev hash tampering", () => {
    const first = {
      id: "op-1",
      eventType: "POLICY_PUBLISH",
      sourceId: "rev-1",
      sourceTable: "policy_revision",
      actorId: "user-1",
      payload: { artifactHash: "sha256:artifact" },
      prevHash: null,
      createdAt: "2026-05-13T18:00:00.000Z",
    };
    const firstHash = buildOperationsContentHash(first);
    const second = {
      id: "op-2",
      eventType: "EVIDENCE_INGEST",
      sourceId: "dec-1",
      sourceTable: "runtime_evidence_event",
      actorId: "svc-1",
      payload: { status: "ALLOW" },
      prevHash: firstHash,
      createdAt: "2026-05-13T18:01:00.000Z",
    };

    expect(validateOperationsLogChain([
      { ...first, contentHash: firstHash },
      { ...second, contentHash: buildOperationsContentHash(second) },
    ])).toEqual({ verified: true, issues: [] });

    const tampered = validateOperationsLogChain([
      { ...first, contentHash: firstHash },
      { ...second, prevHash: "sha256:wrong", contentHash: buildOperationsContentHash(second) },
    ]);
    expect(tampered.verified).toBe(false);
    expect(tampered.issues.map((issue) => issue.kind)).toContain("PREV_HASH_MISMATCH");
  });
});
