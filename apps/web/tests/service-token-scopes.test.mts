import { describe, expect, it } from "vitest";
import {
  ADMIN_ISSUABLE_API_KEY_SCOPES,
  ALL_API_KEY_SCOPES,
  DEV_TOKEN_SCOPES,
} from "../lib/repositories/auth/service-tokens";

describe("service token scopes", () => {
  it("keeps review and publish authority out of runtime agent tokens", () => {
    // A governed agent must never be able to approve or publish the policy that
    // governs it, however its token is issued.
    expect(DEV_TOKEN_SCOPES).not.toContain("approvals:write");
    expect(DEV_TOKEN_SCOPES).not.toContain("publish:write");
    expect(ADMIN_ISSUABLE_API_KEY_SCOPES).toContain("approvals:write");
    expect(ADMIN_ISSUABLE_API_KEY_SCOPES).toContain("publish:write");
  });

  it("no longer carries the retired e2e support scope", () => {
    expect(ALL_API_KEY_SCOPES).not.toContain("e2e:write");
  });

  it("includes runtime decision evaluation in developer and admin-issued tokens", () => {
    expect(DEV_TOKEN_SCOPES).toContain("decision:evaluate");
    expect(ADMIN_ISSUABLE_API_KEY_SCOPES).toContain("decision:evaluate");
  });
});
