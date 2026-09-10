import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBoundTenantId } from "@/lib/tenant-context";

// createAuthSession is reached only from pre-session requests — that is what a
// sign-in is — so nothing has bound a tenant when it runs. createSessionRow's
// client parameter defaults to the tenant-aware `sql`, so a caller that omits it
// writes unbound and throws "No tenant context is bound". Passkey login did
// exactly that on staging: a 500 raised after the assertion had already
// verified, so the user saw a server error on a successful authentication.
//
// The check that exists for this class (check-pre-session-tenant-binding.mjs)
// matches on the `sql` identifier and cannot see a client that arrives as a
// parameter default, so the rule is pinned here instead.

const boundDuringWrite: Array<string | undefined> = [];

vi.mock("@/lib/repositories/auth/session", () => ({
  ensureAuthDemoTenant: async () => {
    boundDuringWrite.push(getBoundTenantId());
  },
  createSessionRow: async () => {
    boundDuringWrite.push(getBoundTenantId());
    return "session-1";
  },
  fetchSessionForAuth: async () => null,
  updateSessionAndPrincipalActivity: async () => {},
  revokeSessionRow: async () => {},
  listAllLoginPrincipals: async () => [],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const { createAuthSession } = await import("../lib/auth-session");

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("createAuthSession tenant binding", () => {
  beforeEach(() => {
    boundDuringWrite.length = 0;
  });

  it("binds the tenant for the session write", async () => {
    await createAuthSession({ principalId: "p-1", tenantId: TENANT, authMethod: "SESSION" });

    expect(boundDuringWrite).not.toHaveLength(0);
    for (const bound of boundDuringWrite) expect(bound).toBe(TENANT);
  });

  it("binds for every sign-in method, not just one", async () => {
    for (const authMethod of ["SESSION", "OIDC", "SAML"] as const) {
      boundDuringWrite.length = 0;
      await createAuthSession({ principalId: "p-1", tenantId: TENANT, authMethod });
      expect(
        boundDuringWrite.every((bound) => bound === TENANT),
        authMethod,
      ).toBe(true);
    }
  });

  it("leaves no binding behind once the session is created", async () => {
    await createAuthSession({ principalId: "p-1", tenantId: TENANT });

    expect(getBoundTenantId()).toBeUndefined();
  });
});
