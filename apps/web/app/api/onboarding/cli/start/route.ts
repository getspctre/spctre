import { startCliOnboarding } from "@/lib/onboarding";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handlePostApiOnboardingCliStart(request: Request) {
  const traceId = extractTraceId(request);
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return withTraceId(Response.json({ error: "Request body must be JSON.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  const agentId = stringValue(record.agentId) ?? "solo-agent";
  const environment = stringValue(record.environment) ?? "production";
  const bundlePath = stringValue(record.bundlePath) ?? "spctre-policy.json";
  const workspaceSlug = stringValue(record.workspaceSlug);
  const controlPlaneUrl =
    stringValue(record.controlPlaneUrl) ??
    new URL(request.url).origin;

  try {
    const started = await startCliOnboarding({
      controlPlaneUrl,
      workspaceSlug,
      agentId,
      environment,
      bundlePath
    });

    return withTraceId(
      Response.json({ ...started, meta: makeMeta(traceId) }, { status: 201, headers: { "cache-control": "no-store" } }),
      traceId
    );
  } catch (error) {
    console.error("[onboarding/cli/start] start failed", error);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export { handlePostApiOnboardingCliStart as POST };
