// OSS slot adapter — resolved dynamically or replaced during commercial builds.
//
// Whether a stranger can create an account is a commercial decision rather than
// a product behavior. A self-hosted deployment has no such notion: its operator
// provisions accounts deliberately, `LOCAL_SIGNUP_ENABLED` covers local
// development, and an endpoint that mints a tenant for anyone who can reach it
// would be a liability rather than a feature. Selling that convenience is what
// a hosted deployment does.
//
// The slot therefore owns the whole operation — which plan a new account starts
// on, how the address is verified, and how abuse is bounded are all packaging.
// What stays on this side is the seam: a route that exists in the routing
// table, and a sign-in surface that offers the option only when something is
// behind it.
//
// The fallback is unavailable rather than an error, in the same way the billing
// webhook's fallback answers 404 with no provider installed. For a deployment
// that does not sell accounts, "no self-serve signup" is the correct answer and
// not a degraded one.
import { logger } from "@spctre/platform/logging";
import { getSpctrePlan } from "@/lib/feature-flags-server";
import { loadCommercialSlot } from "./slot-loader";

export interface SelfServeSignupRequest {
  email: string;
  displayName: string;
  /**
   * Where to send the operator once they prove they control the address —
   * carrying, for instance, the CLI approval they interrupted to sign up.
   *
   * The route has already reduced this to a same-origin path, so an
   * implementation may place it in a link without re-deriving whether doing so
   * is safe. Null means the implementation picks its own landing page.
   */
  returnTo: string | null;
  /**
   * Best-effort origin of the request, for bounding how much one source may
   * create. Null when no trusted proxy header is present.
   *
   * Per-address limiting alone does not bound this endpoint: provisioning is
   * idempotent by address, so repeats are cheap, but each *new* address is a
   * new tenant, and anyone holding a wildcard domain has an unlimited supply.
   *
   * Spoofable by a caller the edge does not front, so an implementation should
   * treat it as one signal among several rather than an identity.
   */
  clientIp: string | null;
}

export type SelfServeSignupOutcome =
  /**
   * The request was well-formed and has been acted on as far as the caller is
   * allowed to observe.
   *
   * Implementations must return this for an address that already has an
   * account as well as for one that does not, and must not vary timing or body
   * between the two. The response is delivered to an unauthenticated caller, so
   * any difference between them is an account-enumeration oracle.
   */
  | { status: "accepted" }
  /** Malformed input. Safe to describe: it is about the request, not the account. */
  | { status: "invalid"; reason: string }
  | { status: "rate_limited"; retryAfterSeconds: number }
  /** No implementation is installed. The route answers 404. */
  | { status: "unavailable" };

export interface SelfServeSignupSlot {
  /**
   * Whether this deployment offers self-serve signup at all.
   *
   * Separate from `start` so the sign-in surface can decide whether to render
   * the option without composing a request it does not intend to send.
   */
  available(): boolean;
  start(request: SelfServeSignupRequest): Promise<SelfServeSignupOutcome>;
}

const fallbackSlot: SelfServeSignupSlot = {
  available: () => false,
  async start() {
    return { status: "unavailable" };
  },
};

export async function loadSelfServeSignupSlot(): Promise<SelfServeSignupSlot> {
  if (getSpctrePlan() === "oss") return fallbackSlot;

  try {
    const module = await loadCommercialSlot<{ selfServeSignupService: SelfServeSignupSlot }>(
      "web/self-serve-signup/index.js",
    );
    return module.selfServeSignupService;
  } catch (err) {
    // Failing closed withholds signup rather than reaching for a shared default.
    // There is no safe default to reach for: the fallback cannot create an
    // account, and anything that could would be creating one on terms no
    // commercial implementation chose.
    logger.error(
      "Failed to load the commercial self-serve signup slot; signup will be unavailable.",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return fallbackSlot;
  }
}
