import { describe, expect, it } from "vitest";
import {
  PUBLIC_PATHS,
  PUBLIC_PATH_PREFIXES,
  SERVICE_API_PATHS,
  SERVICE_API_PATH_PREFIXES,
  SERVICE_API_PATH_PATTERNS,
  PRE_AUTH_BOOTSTRAP_PATHS,
  MACHINE_API_PATHS,
} from "@/lib/proxy-paths";

// The flows a caller with no session must be able to start.
//
// proxy-path-invariants.test.mts checks the path sets against each other, and
// check-proxy-path-coverage.mjs checks that every route appears in one. Neither
// can express the property that actually broke four times, because it belongs
// to a sequence rather than to a path: *the first call of an entry point must
// be reachable before any credential exists*.
//
// Written as the sequences themselves so the requirement is legible. A step
// here is a claim about a product flow — if a step stops being true, either the
// flow changed or the gate did, and both deserve a conversation.

function reachableWithoutSession(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    SERVICE_API_PATHS.has(pathname) ||
    SERVICE_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    SERVICE_API_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

const flows: Array<{ name: string; entrypoint: string; steps: string[] }> = [
  {
    name: "spctre cloud login (device flow)",
    entrypoint: "packages/cli/src/cloud-login.ts",
    steps: [
      // No credential exists yet: the CLI has nothing to present.
      "/api/onboarding/device/start",
      // Where the CLI sends the operator, and the first page a prospect with no
      // account ever sees — it renders the sign-up offer when signed out.
      "/auth/device",
      // Sign-up for a caller who has no account to approve with.
      "/api/onboarding/self-serve",
      // Polled until the browser approves.
      "/api/onboarding/device/token",
    ],
  },
  {
    name: "spctre init (CLI onboarding)",
    entrypoint: "packages/cli/src/init.ts",
    steps: ["/api/onboarding/cli/start", "/onboarding/cli/approve", "/api/onboarding/cli/exchange"],
  },
  {
    name: "hosted checkout provisioning",
    entrypoint: "spctre-site checkout",
    steps: ["/api/internal/provisioning/tenant"],
  },
];

describe("pre-auth bootstrap flows", () => {
  for (const flow of flows) {
    it(`${flow.name} can be started without a session`, () => {
      for (const step of flow.steps) {
        expect(
          reachableWithoutSession(step),
          `${flow.name}: ${step} is behind the session gate, so the flow cannot start. ` +
            `Entry point: ${flow.entrypoint}`,
        ).toBe(true);
      }
    });
  }

  // A pre-auth path accepts an unauthenticated body by definition, so the
  // source-IP allowlist is the only thing standing in front of it. The existing
  // invariant test asserts this for the set; assert it for the flows too, so a
  // new flow step cannot quietly widen the machine API.
  it("never reaches the machine API from a bootstrap step", () => {
    for (const flow of flows) {
      for (const step of flow.steps) {
        if (!PRE_AUTH_BOOTSTRAP_PATHS.has(step)) continue;
        expect(MACHINE_API_PATHS.has(step), `${flow.name}: ${step}`).toBe(false);
      }
    }
  });

  it("declares every API step it walks as a pre-auth bootstrap path", () => {
    const selfAuthenticating = new Set(["/api/internal/provisioning/tenant"]);
    for (const flow of flows) {
      for (const step of flow.steps) {
        if (!step.startsWith("/api/") || selfAuthenticating.has(step)) continue;
        expect(
          PRE_AUTH_BOOTSTRAP_PATHS.has(step),
          `${flow.name}: ${step} is reachable without a session but is not declared ` +
            `a pre-auth bootstrap path, so the invariant test will not police it.`,
        ).toBe(true);
      }
    }
  });
});
