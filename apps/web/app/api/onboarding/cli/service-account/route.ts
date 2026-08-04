import { ensureStarterPublishedBundle } from "@/lib/onboarding";
import {
  isWorkspaceDatabaseConfigured,
  verifyWorkspaceSlugForServiceToken,
} from "@/lib/domains/workspace/service";
import { authenticateServiceToken } from "@/lib/service-tokens";
import { runWithTenantContext } from "@/lib/tenant-context";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";
import { isDemoTenant } from "@/lib/demo-guard";

export const dynamic = "force-dynamic";

async function handlePostApiOnboardingCliServiceAccount(request: Request) {
  const traceId = extractTraceId(request);

  const auth = await authenticateServiceToken(request, "bundle:read");
  if (!auth.ok) {
    return withTraceId(
      Response.json(
        { error: "Invalid or expired service token.", meta: makeMeta(traceId) },
        { status: 401 },
      ),
      traceId,
    );
  }

  if (isDemoTenant(auth.auth.tenantId)) {
    return withTraceId(
      Response.json(
        { error: "CLI onboarding is not available on this instance.", meta: makeMeta(traceId) },
        { status: 403 },
      ),
      traceId,
    );
  }

  if (!isWorkspaceDatabaseConfigured()) {
    return withTraceId(
      Response.json(
        { error: "Database not configured.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  let body: {
    workspaceSlug?: unknown;
    agentId?: unknown;
    environment?: unknown;
    bundlePath?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return withTraceId(
      Response.json({ error: "Invalid JSON body.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  const workspaceSlug = typeof body.workspaceSlug === "string" ? body.workspaceSlug.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "ci-agent";
  const environment = typeof body.environment === "string" ? body.environment.trim() : "production";
  const bundlePath =
    typeof body.bundlePath === "string" ? body.bundlePath.trim() : "spctre-policy.json";

  if (!workspaceSlug) {
    return withTraceId(
      Response.json(
        { error: "workspaceSlug is required.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  let workspace;
  try {
    workspace = await verifyWorkspaceSlugForServiceToken({
      tenantId: auth.auth.tenantId,
      workspaceSlug,
      workspaceId: auth.auth.workspaceId,
    });
  } catch (err) {
    console.error("[onboarding/cli/service-account] verifyWorkspaceSlugForToken failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  if (!workspace) {
    return withTraceId(
      Response.json(
        {
          error: "Workspace not found or token is not scoped to this workspace.",
          meta: makeMeta(traceId),
        },
        { status: 404 },
      ),
      traceId,
    );
  }

  let starter;
  try {
    starter = await runWithTenantContext(auth.auth.tenantId, () =>
      ensureStarterPublishedBundle({
        tenantId: auth.auth.tenantId,
        workspaceId: workspace.id,
        actorId: auth.auth.principalId,
        environment,
      }),
    );
  } catch (err) {
    console.error("[onboarding/cli/service-account] ensureStarterPublishedBundle failed", err);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }

  return withTraceId(
    Response.json({
      tenantId: auth.auth.tenantId,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      agentId,
      environment,
      bundlePath,
      artifactHash: starter.artifactHash,
      branchId: starter.branchId,
      revisionId: starter.revisionId,
      policyContext: [
        {
          scope: "WORKSPACE",
          branchId: starter.branchId,
          revisionId: starter.revisionId,
          artifactHash: starter.artifactHash,
        },
      ],
      meta: makeMeta(traceId),
    }),
    traceId,
  );
}

export { handlePostApiOnboardingCliServiceAccount as POST };
