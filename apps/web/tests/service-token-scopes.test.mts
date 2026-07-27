import { describe, expect, it } from "vitest";
import {
  ADMIN_ISSUABLE_API_KEY_SCOPES,
  ALL_API_KEY_SCOPES,
  DEV_TOKEN_SCOPES,
} from "../lib/repositories/auth/service-tokens";

describe("service token scopes", () => {
  it("keeps e2e:write valid but unavailable to normal admin-issued API keys", () => {
    expect(ALL_API_KEY_SCOPES).toContain("e2e:write");
    expect(ADMIN_ISSUABLE_API_KEY_SCOPES).not.toContain("e2e:write");
  });

  it("includes runtime decision evaluation in developer and admin-issued tokens", () => {
    expect(DEV_TOKEN_SCOPES).toContain("decision:evaluate");
    expect(ADMIN_ISSUABLE_API_KEY_SCOPES).toContain("decision:evaluate");
  });
});
