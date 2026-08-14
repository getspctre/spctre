import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SPCTRE_OPENAPI_SPEC } from "@spctre/api-contracts";
import { describe, expect, it } from "vitest";
import {
  MACHINE_API_PATH_PREFIXES,
  MACHINE_API_PATHS,
  PUBLIC_API_PREFIX,
  PUBLIC_PATH_PREFIXES,
  PUBLIC_PATHS,
  SERVICE_API_PATH_PREFIXES,
  SERVICE_API_PATHS,
  SERVICE_API_PATH_PATTERNS,
} from "@/lib/proxy-paths";

// `/api/v1` is excused from both proxy gates by prefix rather than by exact
// path. That is only defensible while the surface behind the prefix is a
// reviewed one, which is what this file enforces: the published spec and the
// routes under app/api/v1 must describe the same set, in both directions.
//
// Without it, `/api/v1/<anything>` reaches the internet the moment a directory
// is created, which is the failure MACHINE_API_PATHS is enumerated to avoid.

const V1_ROOT = join(process.cwd(), "app", "api", "v1");

/** Spec paths are relative to the `/api/v1` server; make them absolute. */
function specPaths(): string[] {
  return Object.keys(SPCTRE_OPENAPI_SPEC.paths ?? {}).map((p) => `/api/v1${p}`);
}

/** Every directory under app/api/v1 holding a route.ts, as a URL path. */
function routePaths(dir = V1_ROOT, prefix = "/api/v1"): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "route.ts") {
      found.push(prefix);
      continue;
    }
    if (statSync(full).isDirectory()) found.push(...routePaths(full, `${prefix}/${entry}`));
  }
  return found;
}

/**
 * Next.js `[id]` ↔ OpenAPI `{id}`, and `[...rest]` catch-alls, which match any
 * deeper path and so stand in for every spec path beneath them.
 */
function toMatcher(routePath: string): RegExp {
  const pattern = routePath
    .split("/")
    .map((segment) => {
      if (/^\[\.\.\..+\]$/.test(segment)) return "(?:.+)";
      if (/^\[.+\]$/.test(segment)) return "(?:\\{[^/]+\\}|[^/]+)";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${pattern}$`);
}

function reachablePastSessionGate(pathname: string): boolean {
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

function exemptFromSourceIpGate(pathname: string): boolean {
  return (
    MACHINE_API_PATHS.has(pathname) ||
    MACHINE_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

describe("published API contract", () => {
  it("declares bearer auth globally, which is what justifies the prefix", () => {
    // Both gate exemptions rest on this: every documented path answers to a
    // credential it verifies itself. If the spec stops saying so, the prefix
    // is no longer a safe way to grant them.
    expect(SPCTRE_OPENAPI_SPEC.security).toEqual([{ bearerAuth: [] }]);
    expect(SPCTRE_OPENAPI_SPEC.servers?.[0]?.url).toBe(PUBLIC_API_PREFIX.replace(/\/$/, ""));
  });

  it("reaches every documented path past the session gate", () => {
    const stranded = specPaths().filter((pathname) => !reachablePastSessionGate(pathname));

    expect(stranded).toEqual([]);
  });

  it("exempts every documented path from the source-IP allowlist", () => {
    // Customers and generated SDKs call these from their own networks. An
    // operator allowlist in front of them makes the published API unusable.
    const blocked = specPaths().filter((pathname) => !exemptFromSourceIpGate(pathname));

    expect(blocked).toEqual([]);
  });

  it("implements every documented path", () => {
    // A path in the spec with no route behind it ships as a method on the
    // generated SDKs that 404s.
    const matchers = routePaths().map(toMatcher);
    const undelivered = specPaths().filter(
      (pathname) => !matchers.some((matcher) => matcher.test(pathname)),
    );

    expect(undelivered).toEqual([]);
  });

  it("documents every route on the published surface", () => {
    // The reverse direction, and the one the prefix depends on: a route added
    // under /api/v1 is internet-reachable as soon as it exists, so it may not
    // exist without being described in the contract that grants it that.
    const documented = specPaths();
    const undocumented = routePaths().filter((routePath) => {
      const matcher = toMatcher(routePath);
      return !documented.some((pathname) => matcher.test(pathname));
    });

    expect(undocumented).toEqual([]);
  });
});
