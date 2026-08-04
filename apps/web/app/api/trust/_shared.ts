import { getAuthSession } from "@/lib/auth-session";
import { evidenceIngestUrl, workerInternalSecret } from "@/lib/platform/config";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";
import { getActiveScope } from "@/lib/workspace";
import { authenticateServiceToken, hasBearerToken } from "@/lib/service-tokens";
import { withTraceId } from "@spctre/api-contracts";
import { swallow } from "@/lib/platform/swallow";
export { asInt, asNumber, asString } from "../_shared";

export const VALID_STACKS = new Set([
  "AWS_BEDROCK",
  "GOOGLE_ADK",
  "AZURE_AI",
  "LANGCHAIN",
  "LANGGRAPH",
  "CREWAI",
  "AUTOGEN",
  "OPENAI_AGENTS",
  "OMNIGENT",
  "OPENCODE",
  "CLAUDE_CODE",
  "LOCAL",
  "CUSTOM",
]);

export async function resolveAuth(
  request: Request,
): Promise<
  | { ok: true; tenantId: string; workspaceId: string; actorId: string }
  | { ok: false; error: string }
> {
  if (hasBearerToken(request)) {
    const tokenAuth = await authenticateServiceToken(request, "evidence:write");
    if (!tokenAuth.ok) return { ok: false, error: tokenAuth.error };
    return {
      ok: true,
      tenantId: tokenAuth.auth.tenantId,
      workspaceId: tokenAuth.auth.workspaceId,
      actorId: tokenAuth.auth.principalId,
    };
  }
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) return { ok: false, error: "Authentication required." };
  const ctx = await getActiveScope().catch(swallow("getActiveScope", null));
  if (!ctx) return { ok: false, error: "Workspace context unavailable." };
  return {
    ok: true,
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    actorId: session.principalId,
  };
}

export async function delegateTrustPostToWorker(params: {
  path: "ingest" | "evaluate" | "context-budget";
  auth: { tenantId: string; workspaceId: string; actorId: string };
  body: Record<string, unknown>;
  traceId: string;
}): Promise<Response | null> {
  const baseUrl = evidenceIngestUrl();
  const secret = workerInternalSecret();
  if (!baseUrl || !secret) return null;

  const target = new URL(
    `/api/trust/${params.path}`,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const response = await fetchWithTimeout(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": params.traceId,
      "x-spctre-internal-secret": secret,
      "x-spctre-tenant-id": params.auth.tenantId,
      "x-spctre-workspace-id": params.auth.workspaceId,
      "x-spctre-actor-id": params.auth.actorId,
    },
    body: JSON.stringify(params.body),
    cache: "no-store",
    timeoutMs: 15_000,
  });

  return withTraceId(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    params.traceId,
  );
}
