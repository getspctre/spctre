import { AsyncLocalStorage } from "node:async_hooks";
import { assertTenantId } from "@/lib/tenant-id";

/**
 * Tenant context for RLS scoping, shared by the tenant-aware DB client and
 * domain services. Lives outside lib/db so domain services can bind a tenant
 * without importing the database client (which is reserved for
 * lib/repositories/*).
 */
const tenantContext = new AsyncLocalStorage<string>();

// Re-exported so existing importers keep working; the implementation lives in
// lib/tenant-id (async_hooks-free) so client-reachable config modules can
// validate a tenant id without bundling AsyncLocalStorage.
export { assertTenantId };

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
