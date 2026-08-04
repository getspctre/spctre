import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../lib/domains", import.meta.url));
const APP_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const collected = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectTsFiles(fullPath);
      }
      return /\.(?:mts|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    }),
  );

  return collected.flat();
}

describe("domain import boundaries", () => {
  it("prevents cross-domain repository and service imports", async () => {
    const files = await collectTsFiles(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");
      const ownDomain = relative.split("/")[0];
      const matches = source.matchAll(/from\s+"@\/lib\/domains\/([^/]+)\/[^\"]+"/g);

      for (const match of matches) {
        const importedDomain = match[1];
        if (importedDomain !== ownDomain) {
          violations.push(`${relative} imports ${importedDomain}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps domain services free of request context (no next/headers or getActiveScope)", async () => {
    // Keep in sync with the apps/web/lib/domains/** block in eslint.config.mjs.
    // Domains receive scope as an explicit parameter; they must not read cookies
    // or resolve the active scope from ambient request state. Importing the
    // ActiveScope *type* is allowed.
    const files = await collectTsFiles(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(ROOT, file).replaceAll(path.sep, "/");

      if (source.match(/from\s+["']next\/headers["']/)) {
        violations.push(`${relative} imports next/headers`);
      }
      // Flag value imports of getActiveScope from the workspace module or its
      // scope submodule; `import type { ... }` is fine.
      if (
        source.match(
          /import\s+(?!type\b)[^;]*\bgetActiveScope\b[^;]*from\s+["']@\/lib\/workspace(?:\/scope)?["']/,
        )
      ) {
        violations.push(`${relative} imports getActiveScope`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps raw database imports inside repository and platform boundaries", async () => {
    const files = await collectTsFiles(APP_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(APP_ROOT, file).replaceAll(path.sep, "/");
      // Keep in sync with DB_BOUNDARY_INFRA_ALLOWLIST in eslint.config.mjs.
      // Domain services bind tenancy via @/lib/tenant-context, not @/lib/db.
      if (
        relative === "lib/db.ts" ||
        relative === "lib/auth-rate-limit.ts" ||
        relative.startsWith("lib/repositories/") ||
        relative === "app/api/ready/route.ts"
      ) {
        continue;
      }

      const source = await readFile(file, "utf8");
      if (source.match(/from\s+["'](?:@\/lib\/db|\.{1,2}\/(?:\.{1,2}\/)*db)["']/)) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });

  it("prevents new first-party imports from @/lib/workspace-context (facade only)", async () => {
    const files = await collectTsFiles(APP_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(APP_ROOT, file).replaceAll(path.sep, "/");
      if (relative === "lib/workspace-context.ts") continue;

      const source = await readFile(file, "utf8");
      if (
        source.match(
          /from\s+["'](?:@\/lib\/workspace-context|\.{1,2}\/(?:\.{1,2}\/)*workspace-context)["']/,
        )
      ) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });

  it("prevents client-safe workspace modules from importing server-only APIs", async () => {
    const CLIENT_SAFE = [
      "lib/workspace/types.ts",
      "lib/workspace/cookies.ts",
      "lib/workspace/format.ts",
    ];
    const SERVER_ONLY_PATTERNS = [
      /from\s+["']next\/headers["']/,
      /from\s+["']@\/lib\/auth-session["']/,
      /from\s+["']@\/lib\/repositories\//,
    ];
    const violations: string[] = [];

    for (const relative of CLIENT_SAFE) {
      const file = path.join(APP_ROOT, relative);
      const source = await readFile(file, "utf8").catch(() => "");
      for (const pattern of SERVER_ONLY_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${relative} imports server-only dependency`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
