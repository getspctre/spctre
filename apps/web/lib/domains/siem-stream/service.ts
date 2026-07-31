import { CodedError } from "@/lib/errors/coded-error";
import { getAuthSession } from "@/lib/auth-session";
import { isFeatureEnabled } from "@/lib/feature-flags-server";
import { getWorkspaceContext, getRequiredWorkspaceContext } from "@/lib/workspace";
import { validateWebhookUrl, validateSentinelWorkspaceId } from "@/lib/platform/url-guard";
import {
  listSiemStreams,
  createSiemStream,
  deleteSiemStream,
  toggleSiemStream,
  type SiemStream,
} from "@/lib/repositories/siem-stream";
import { swallow } from "@/lib/platform/swallow";

function requireSiemFeature() {
  if (!isFeatureEnabled("siemEventStreaming")) {
    throw new CodedError("PLAN_REQUIRED", { plan: "Cloud" });
  }
}

function requireCredentialKey(): string {
  const key = process.env.SPCTRE_CREDENTIAL_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "SPCTRE_CREDENTIAL_ENCRYPTION_KEY is not set. Configure this environment variable before creating SIEM streams."
    );
  }
  return key;
}

export type { SiemStream };

export async function getSiemStreamPageModel(params: { workspaceSlug?: string }) {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: params.workspaceSlug });
  const streams = await listSiemStreams(workspaceContext.tenantId, workspaceContext.workspaceId);
  return { workspaceContext, streams };
}

export async function addSiemStreamDecision(params: {
  workspaceId: string;
  name: string;
  type: "SPLUNK_HEC" | "SENTINEL";
  url: string;
  config?: Record<string, unknown>;
  credentials: Record<string, unknown>;
}) {
  requireSiemFeature();
  const credentialKey = requireCredentialKey();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");

  if (params.type === "SENTINEL") {
    validateSentinelWorkspaceId(params.url);
  } else {
    validateWebhookUrl(params.url);
  }

  return createSiemStream(
    session.tenantId,
    params.workspaceId,
    params.name,
    params.type,
    params.url,
    params.config ?? {},
    JSON.stringify(params.credentials),
    credentialKey
  );
}

export async function removeSiemStreamDecision(params: { workspaceId: string; id: string }) {
  requireSiemFeature();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");
  return deleteSiemStream(session.tenantId, params.workspaceId, params.id);
}

export async function toggleSiemStreamDecision(params: {
  workspaceId: string;
  id: string;
  enabled: boolean;
}) {
  requireSiemFeature();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) throw new CodedError("AUTH_REQUIRED");
  const ctx = await getRequiredWorkspaceContext();
  if (ctx.workspaceId !== params.workspaceId) throw new CodedError("INVALID_WORKSPACE");
  return toggleSiemStream(session.tenantId, params.workspaceId, params.id, params.enabled);
}
