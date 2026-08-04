import { defineConfig } from "vitest/config";

// Root config used only for aggregated, report-only coverage across the
// TypeScript packages via `pnpm test:coverage`. Per-package `pnpm test` runs
// are unaffected — they execute in each package and use that package's own
// vitest.config. apps/web is covered separately (it needs Postgres) via
// `pnpm test:coverage:web`.
export default defineConfig({
  test: {
    projects: [
      "packages/policy-schema",
      "packages/cli",
      "packages/sdk",
      "packages/mcp-server",
      "packages/api-contracts",
      "packages/platform",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/*.test.*", "**/*.config.*", "packages/sdk/src/schema.ts"],
    },
  },
});
