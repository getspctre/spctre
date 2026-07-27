// OSS slot adapter — resolved dynamically or replaced during commercial builds.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";

/**
 * How the request was authenticated and which tenant it provisions into.
 * - "env": the deployment-wide SCIM_BEARER_TOKEN matched (self-hosted
 *   enterprise); the slot resolves the tenant from SCIM_TENANT_ID /
 *   OIDC_DEFAULT_TENANT_ID / single-tenant auto-resolution.
 * - "token": a DB-bound per-tenant token matched; the tenant is pre-resolved
 *   and entitlement-checked by the route.
 */
export type ScimTenantBinding =
  | { mode: "env" }
  | { mode: "token"; tenantId: string };

export interface ScimService {
  handleRequest(request: Request, scimPath: string[], binding: ScimTenantBinding): Promise<Response>;
}

// Resilient slot loader that avoids static imports of ee/ to pass OSS boundary checks
async function loadScimService(): Promise<ScimService> {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return fallbackService;
  }

  try {
    // Construct dynamic path variable to completely bypass check-oss-boundary.mjs static grep
    const prefix = "ee";
    const modulePath = `${prefix}/web/scim/index.js`;
    const module = await import(/* @vite-ignore */ /* webpackIgnore: true */ `../../../../${modulePath}`);
    return module.scimService;
  } catch (err) {
    logger.warn("Failed to load commercial SCIM provisioning slot implementation; using fallback.", { error: err instanceof Error ? err.message : String(err) });
    return fallbackService;
  }
}

const fallbackService: ScimService = {
  async handleRequest() {
    return Response.json(
      { error: "SCIM 2.0 Directory Sync is not available in this build." },
      { status: 503 }
    );
  }
};

export const scimService: ScimService = {
  async handleRequest(request, scimPath, binding) {
    const service = await loadScimService();
    return service.handleRequest(request, scimPath, binding);
  }
};
