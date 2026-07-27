import { DEMO_TENANT_ID } from "./demo";

export function isDemoTenant(tenantId: string): boolean {
  return tenantId === DEMO_TENANT_ID;
}

export function canUseDemoFallbackData(tenantId: string): boolean {
  return isDemoTenant(tenantId);
}

export function verifyWriteAccess(tenantId: string): { allowed: boolean; error?: string } {
  if (isDemoTenant(tenantId)) {
    return {
      allowed: false,
      error: "This action is read-only in Demo Mode. Create a free Spctre Cloud account to save changes!"
    };
  }
  return { allowed: true };
}
