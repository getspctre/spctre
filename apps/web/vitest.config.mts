import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.mts", "../../ee/web/**/*.test.mts"],
    // Report-only coverage baseline (`pnpm test:coverage:web`). No thresholds.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["app/**", "components/**", "lib/**", "i18n/**"],
      exclude: ["**/*.d.ts", "**/*.test.mts", "**/*.config.*"],
    },
  },
  resolve: {
    // Array form so the policy-schema entries can be exact-match regexes:
    // a plain-string alias would also rewrite subpaths like
    // "@spctre/policy-schema/packs", which must keep resolving independently.
    // These point the workspace policy-schema at its TypeScript source so tests
    // run against current source without a dist rebuild (matching the package's
    // `types` export condition; runtime still resolves to built dist/).
    alias: [
      { find: "@", replacement: fromHere("./") },
      {
        find: /^@spctre\/policy-schema$/,
        replacement: fromHere("../../packages/policy-schema/src/index.ts"),
      },
      {
        find: /^@spctre\/policy-schema\/packs$/,
        replacement: fromHere("../../packages/policy-schema/src/packs.ts"),
      },
      {
        find: /^@spctre\/policy-schema\/types$/,
        replacement: fromHere("../../packages/policy-schema/src/types.ts"),
      },
    ],
  },
});
