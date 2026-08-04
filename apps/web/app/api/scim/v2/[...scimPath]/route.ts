import { createHash, timingSafeEqual } from "node:crypto";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { scimService } from "@/lib/ee-adapters/scim";
import { resolveScimTokenBinding } from "@/lib/domains/scim-token/service";

export const dynamic = "force-dynamic";

// Constant-time comparison over fixed-length digests so neither content nor
// length of the configured secret leaks through timing.
function safeSecretEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function canBypassScimAuthForLocalDev(): boolean {
  return (
    process.env.NODE_ENV !== "production" && process.env.SCIM_ALLOW_UNAUTHENTICATED_DEV === "true"
  );
}

// OSS boundary: authentication, tenant binding, and entitlement live here; the
// SCIM 2.0 protocol implementation is a commercial slot resolved via
// @/lib/ee-adapters/scim. Two credential modes:
// - Deployment-wide env token (SCIM_BEARER_TOKEN): self-hosted Enterprise only.
// - Per-tenant DB-bound token (scim_token_registration): hosted deployments;
//   the token identifies the tenant and the tenant's plan is entitlement-checked.
async function handleScimRequest(
  request: Request,
  { params }: { params: Promise<{ scimPath: string[] }> },
) {
  const plan = getSpctrePlan();
  if (plan === "oss") {
    return Response.json(
      { error: "SCIM 2.0 Directory Sync is an Enterprise-only feature." },
      { status: 403 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const envSecret = process.env.SCIM_BEARER_TOKEN || process.env.SCIM_SECRET;
  const { scimPath } = await params;

  if (envSecret && safeSecretEqual(authHeader, `Bearer ${envSecret}`)) {
    if (plan !== "enterprise") {
      return Response.json(
        {
          error:
            "The deployment-wide SCIM token is limited to Enterprise deployments; use a per-tenant SCIM token.",
        },
        { status: 403 },
      );
    }
    return scimService.handleRequest(request, scimPath, { mode: "env" });
  }

  if (bearerToken) {
    const binding = await resolveScimTokenBinding(bearerToken);
    if (!binding.ok) {
      if (binding.reason === "not_entitled") {
        return Response.json(
          { error: "SCIM 2.0 Directory Sync requires an Enterprise subscription." },
          { status: 403 },
        );
      }
      return Response.json({ error: "Unauthorized SCIM request." }, { status: 401 });
    }
    return scimService.handleRequest(request, scimPath, {
      mode: "token",
      tenantId: binding.tenantId,
    });
  }

  if (!envSecret && canBypassScimAuthForLocalDev()) {
    return scimService.handleRequest(request, scimPath, { mode: "env" });
  }

  return Response.json({ error: "Unauthorized SCIM request." }, { status: 401 });
}

export {
  handleScimRequest as GET,
  handleScimRequest as POST,
  handleScimRequest as PUT,
  handleScimRequest as PATCH,
  handleScimRequest as DELETE,
};
