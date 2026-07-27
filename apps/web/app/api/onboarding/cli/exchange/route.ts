import { exchangeCliOnboardingCode } from "@/lib/onboarding";
import { extractTraceId, makeMeta, withTraceId } from "@spctre/api-contracts";

export const dynamic = "force-dynamic";

async function handlePostApiOnboardingCliExchange(request: Request) {
  const traceId = extractTraceId(request);
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return withTraceId(Response.json({ error: "Request body must be JSON.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }

  const code =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? typeof (payload as Record<string, unknown>).code === "string"
        ? ((payload as Record<string, unknown>).code as string).trim()
        : ""
      : "";
  if (!code) return withTraceId(Response.json({ error: "code is required.", meta: makeMeta(traceId) }, { status: 400 }), traceId);

  try {
    const exchanged = await exchangeCliOnboardingCode(code);
    return withTraceId(
      Response.json({ ...exchanged, meta: makeMeta(traceId) }, { headers: { "cache-control": "no-store" } }),
      traceId
    );
  } catch (error) {
    const message = String(error);
    const pending = message.includes("waiting for browser approval");
    if (pending) {
      return withTraceId(Response.json({ error: message, meta: makeMeta(traceId) }, { status: 202 }), traceId);
    }
    console.error("[onboarding/cli/exchange] exchange failed", error);
    return withTraceId(Response.json({ error: "Invalid or expired onboarding code.", meta: makeMeta(traceId) }, { status: 400 }), traceId);
  }
}

export { handlePostApiOnboardingCliExchange as POST };
