import { describe, expect, it } from "vitest";
import { reservedStableRuleIdError } from "../lib/policy/reserved-rule-ids";

describe("reserved advisor stable rule IDs", () => {
  it("rejects the reserved prefix regardless of case", () => {
    expect(reservedStableRuleIdError(["SpCtRe-AgEnT.policy.override"])).toContain(
      "reserved for Spctre Advisor Governance",
    );
  });

  it("allows customer namespaces", () => {
    expect(reservedStableRuleIdError(["acme.advisor.require-review"])).toBeNull();
  });
});
