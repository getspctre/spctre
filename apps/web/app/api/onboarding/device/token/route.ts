import { exchangeDeviceCode } from "@/lib/onboarding";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

// RFC 8628 §3.5 — CLI polls this endpoint with device_code until approved, expired, or too fast
async function handlePostApiOnboardingDeviceToken(request: Request) {
  const traceId = extractTraceId(request);
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return withTraceId(
      Response.json(
        { error: "Request body must be JSON.", meta: makeMeta(traceId) },
        { status: 400 },
      ),
      traceId,
    );
  }

  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const deviceCode = typeof record.deviceCode === "string" ? record.deviceCode.trim() : "";

  if (!deviceCode) {
    return withTraceId(
      Response.json({ error: "deviceCode is required.", meta: makeMeta(traceId) }, { status: 400 }),
      traceId,
    );
  }

  try {
    const result = await exchangeDeviceCode(deviceCode);

    switch (result.status) {
      case "pending":
        return withTraceId(
          Response.json(
            { error: "authorization_pending", meta: makeMeta(traceId) },
            { status: 428 },
          ),
          traceId,
        );
      case "slow_down":
        return withTraceId(
          Response.json({ error: "slow_down", meta: makeMeta(traceId) }, { status: 429 }),
          traceId,
        );
      case "expired":
        return withTraceId(
          Response.json({ error: "expired_token", meta: makeMeta(traceId) }, { status: 400 }),
          traceId,
        );
      case "authorized":
        return withTraceId(
          Response.json(
            { ...result.exchange, meta: makeMeta(traceId) },
            { headers: { "cache-control": "no-store" } },
          ),
          traceId,
        );
    }
  } catch (error) {
    console.error("[onboarding/device/token] exchange failed", error);
    return withTraceId(
      Response.json(
        { error: "Service temporarily unavailable.", meta: makeMeta(traceId) },
        { status: 503 },
      ),
      traceId,
    );
  }
}

export { handlePostApiOnboardingDeviceToken as POST };
