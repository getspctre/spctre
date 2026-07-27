import { describe, expect, it } from "vitest";
import { classifyProductionHeartbeat } from "../lib/domains/agents/service";

const expected = {
  branchId: "branch-production",
  revisionId: "revision-42",
  artifactHash: "sha256:current",
};
const now = Date.parse("2026-07-20T12:00:00.000Z");

function heartbeat(overrides: Partial<Parameters<typeof classifyProductionHeartbeat>[0]> = {}) {
  return classifyProductionHeartbeat({
    observedAt: "2026-07-20T11:30:00.000Z",
    artifactHash: "sha256:current",
    policyContext: [{ ...expected }],
    expected,
    now,
    ...overrides,
  });
}

describe("production heartbeat assurance", () => {
  it("requires the heartbeat context and artifact to match the published bundle", () => {
    expect(heartbeat()).toBe("CURRENT");
    expect(heartbeat({ artifactHash: "sha256:old" })).toBe("DRIFTED");
    expect(heartbeat({ policyContext: [{ ...expected, revisionId: "revision-old" }] })).toBe("DRIFTED");
  });

  it("does not award assurance when provenance is absent", () => {
    expect(heartbeat({ expected: null })).toBe("PROVENANCE_GAP");
    expect(heartbeat({ policyContext: [] })).toBe("PROVENANCE_GAP");
  });

  it("marks a heartbeat stale after one hour", () => {
    expect(heartbeat({ observedAt: "2026-07-20T10:59:59.000Z" })).toBe("STALE");
  });
});
