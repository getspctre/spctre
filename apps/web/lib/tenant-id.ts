const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure tenant-id validation. Deliberately free of `node:async_hooks` (unlike
 * `tenant-context`, which instantiates AsyncLocalStorage) so config and other
 * client-reachable modules can validate a tenant id without pulling
 * AsyncLocalStorage into a browser bundle.
 */
export function assertTenantId(tenantId: string | null | undefined): asserts tenantId is string {
  if (tenantId == null || tenantId.trim() === "") throw new Error("Tenant ID is required.");
  if (!UUID_RE.test(tenantId)) throw new Error("Invalid tenant ID.");
}
