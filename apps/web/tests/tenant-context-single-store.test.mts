import { describe, expect, it, vi } from "vitest";

// The production build inlines lib/tenant-context into every chunk that reaches
// it, so a request can bind through one copy and query through another. With a
// module-local AsyncLocalStorage the bind is invisible to the reader and the
// query throws from correctly wrapped code.
//
// vi.resetModules() gives two genuinely separate module instances, which is the
// same situation the bundler creates.
describe("tenant context store", () => {
  it("is shared across separate module instances", async () => {
    vi.resetModules();
    const binder = await import("../lib/tenant-context");

    vi.resetModules();
    const reader = await import("../lib/tenant-context");

    expect(binder, "resetModules should yield distinct instances").not.toBe(reader);

    const tenantId = "00000000-0000-0000-0000-000000000001";
    const seen = await binder.runWithTenantContext(tenantId, async () => reader.getBoundTenantId());

    expect(seen).toBe(tenantId);
  });

  it("still clears the binding once the callback settles", async () => {
    vi.resetModules();
    const { runWithTenantContext, getBoundTenantId } = await import("../lib/tenant-context");

    await runWithTenantContext("00000000-0000-0000-0000-000000000001", async () => undefined);

    expect(getBoundTenantId()).toBeUndefined();
  });

  it("keeps concurrent bindings isolated from each other", async () => {
    vi.resetModules();
    const { runWithTenantContext, getBoundTenantId } = await import("../lib/tenant-context");

    const a = "00000000-0000-0000-0000-00000000000a";
    const b = "00000000-0000-0000-0000-00000000000b";

    const [seenA, seenB] = await Promise.all([
      runWithTenantContext(a, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getBoundTenantId();
      }),
      runWithTenantContext(b, async () => getBoundTenantId()),
    ]);

    expect(seenA).toBe(a);
    expect(seenB).toBe(b);
  });
});
