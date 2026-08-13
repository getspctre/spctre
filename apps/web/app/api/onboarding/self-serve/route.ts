import { withApiRoute } from "@/lib/platform/api-route";
import { loadSelfServeSignupSlot } from "@/lib/ee-adapters/self-serve-signup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FIELD_LENGTH = 200;

/**
 * Reduce a caller-supplied destination to a same-origin path, or drop it.
 *
 * The value survives into a link sent by email, so an absolute URL here would
 * be an open redirect wearing a trusted sender's name. Rejecting outright
 * rather than repairing keeps the rule legible: a path, rooted, and not
 * protocol-relative. `//evil.example` parses as a host in a browser despite
 * starting with a slash, which is the case a bare `startsWith("/")` misses.
 */
function sameOriginPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_FIELD_LENGTH) return null;
  if (!candidate.startsWith("/")) return null;
  if (candidate.startsWith("//")) return null;
  // A backslash is treated as a path separator by some URL parsers, so "/\evil"
  // can escape the origin in the same way "//evil" does.
  if (candidate.startsWith("/\\")) return null;
  return candidate;
}

function readField(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_FIELD_LENGTH) : "";
}

/**
 * Begin self-serve signup.
 *
 * Deliberately thin: the deployment's commercial slot decides what an account
 * starts as and how the address is verified. This handler owns only what is
 * true regardless of who implements it — that the destination is same-origin,
 * and that the response says the same thing whether or not the address already
 * has an account.
 */
export const POST = withApiRoute("/api/onboarding/self-serve", async (request, ctx) => {
  const slot = await loadSelfServeSignupSlot();
  // 404 rather than 403: on a deployment that does not sell accounts there is
  // nothing behind this path, and saying so is not withholding a permission.
  if (!slot.available()) return ctx.error(404, "Not found.");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return ctx.error(400, "Invalid JSON body.");
  }

  const outcome = await slot.start({
    email: readField(body.email).toLowerCase(),
    displayName: readField(body.displayName),
    returnTo: sameOriginPath(body.returnTo),
    // Leftmost hop, matching the ingest routes. Only as trustworthy as the
    // edge that sets it, which is why the contract calls it best-effort.
    clientIp: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
  });

  switch (outcome.status) {
    case "accepted":
      // Carries no account state by design — see SelfServeSignupOutcome.
      return ctx.json({ ok: true });
    case "invalid":
      return ctx.error(400, outcome.reason);
    case "rate_limited": {
      const response = ctx.error(
        429,
        "Too many signup requests. Please wait before trying again.",
        { retryAfterSeconds: outcome.retryAfterSeconds },
      );
      response.headers.set("Retry-After", String(outcome.retryAfterSeconds));
      return response;
    }
    case "unavailable":
      return ctx.error(404, "Not found.");
  }
});
