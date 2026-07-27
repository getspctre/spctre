import { startDeviceOnboarding } from "@/lib/onboarding";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handlePostApiOnboardingDeviceStart(request: Request) {
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

  const agentId = str(record.agentId) ?? "solo-agent";
  const environment = str(record.environment) ?? "production";
  const bundlePath = str(record.bundlePath) ?? "spctre-policy.json";
  const workspaceSlug = str(record.workspaceSlug);
  const controlPlaneUrl = str(record.controlPlaneUrl) ?? new URL(request.url).origin;
  const trial = typeof record.trial === "boolean" ? record.trial : false;

  try {
    const started = await startDeviceOnboarding({
      controlPlaneUrl,
      workspaceSlug,
      agentId,
      environment,
      bundlePath,
      trial,
    });
    return withTraceId(
      Response.json({ ...started, meta: makeMeta(traceId) }, { status: 201, headers: { "cache-control": "no-store" } }),
      traceId
    );
  } catch (error) {
    console.error("[onboarding/device/start] start failed", error);
    return withTraceId(Response.json({ error: "Service temporarily unavailable.", meta: makeMeta(traceId) }, { status: 503 }), traceId);
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export { handlePostApiOnboardingDeviceStart as POST };
