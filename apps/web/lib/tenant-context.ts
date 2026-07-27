import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tenant context for RLS scoping, shared by the tenant-aware DB client and
 * domain services. Lives outside lib/db so domain services can bind a tenant
 * without importing the database client (which is reserved for
 * lib/repositories/*).
 */
const tenantContext = new AsyncLocalStorage<string>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertTenantId(tenantId: string | null | undefined): asserts tenantId is string {
  if (tenantId == null || tenantId.trim() === "") throw new Error("Tenant ID is required.");
  if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID.");
}

/** Returns the tenant bound by runWithTenantContext, if any. */
export function getBoundTenantId(): string | undefined {
  return tenantContext.getStore();
}

export async function runWithTenantContext<T>(
  tenantId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  assertTenantId(tenantId);
  return tenantContext.run(tenantId, fn);
}
