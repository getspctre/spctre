import { AsyncLocalStorage } from "node:async_hooks";
import { assertTenantId } from "@/lib/tenant-id";

/**
 * Tenant context for RLS scoping, shared by the tenant-aware DB client and
 * domain services. Lives outside lib/db so domain services can bind a tenant
 * without importing the database client (which is reserved for
 * lib/repositories/*).
 *
 * Pinned to the process rather than the module. The production build inlines
 * this module into every chunk that reaches it — `lib/db` alone lands in four
 * server chunks, each carrying its own copy — and a module-local
 * AsyncLocalStorage would give each copy a private store. A route whose
 * `runWithTenantContext` and whose `sql` resolve to different copies then binds
 * a tenant that the query cannot see, and the bind silently does nothing:
 * `resolveTenantContext` finds no store and throws "Bearer-token database work
 * requires an explicit tenant context" from code that is correctly wrapped.
 *
 * Whether any given route straddles two copies is decided by chunking, so the
 * binding was only ever correct by accident. One store per process removes the
 * accident. The DB pool is held on globalThis for the same reason.
 */
const TENANT_CONTEXT_KEY = Symbol.for("spctre.tenant-context.als");

type TenantContextGlobal = typeof globalThis & { [TENANT_CONTEXT_KEY]?: AsyncLocalStorage<string> };

const globalScope = globalThis as TenantContextGlobal;

const tenantContext: AsyncLocalStorage<string> = (globalScope[TENANT_CONTEXT_KEY] ??=
  new AsyncLocalStorage<string>());

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
  fn: () => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  return tenantContext.run(tenantId, fn);
}
