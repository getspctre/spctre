import { describe, expect, it } from "vitest";
import {
  PUBLIC_PATH_PREFIXES,
  PUBLIC_PATHS,
  SELF_AUTHENTICATING_PATHS,
  SERVICE_API_PATH_PREFIXES,
  SERVICE_API_PATHS,
} from "@/lib/proxy-paths";

function reachablePastSessionGate(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    SERVICE_API_PATHS.has(pathname) ||
    SERVICE_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/")
  );
}

describe("proxy path invariants", () => {
  // The proxy applies two independent gates: a source-IP allowlist, and a
  // session check that answers 401 for any /api/ path that is not a service
  // path. Excusing an endpoint from the first without the second produces a
  // failure that looks handled — the exemption is right there in the code —
  // and it has happened three times: the Paddle billing webhook, the internal
  // provisioning API, and once before that.
  it("keeps every allowlist-exempt path reachable past the session gate", () => {
    const stranded = [...SELF_AUTHENTICATING_PATHS].filter(
      (pathname) => !reachablePastSessionGate(pathname),
    );

    expect(stranded).toEqual([]);
  });

  it("only exempts API paths, which is the surface the allowlist guards", () => {
    const nonApi = [...SELF_AUTHENTICATING_PATHS].filter(
      (pathname) => !pathname.startsWith("/api/"),
    );

    expect(nonApi).toEqual([]);
  });

  it("does not exempt a path that a browser session would also reach", () => {
    // A self-authenticating endpoint answers to a credential, never to a
    // cookie. Overlap with the public set would mean it is reachable for a
    // reason other than the one claimed.
    const alsoPublic = [...SELF_AUTHENTICATING_PATHS].filter((pathname) =>
      PUBLIC_PATHS.has(pathname),
    );

    expect(alsoPublic).toEqual([]);
  });
});
