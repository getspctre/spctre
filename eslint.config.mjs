import tseslint from "typescript-eslint";

// Enforced in CI via `pnpm lint`. The vitest suite
// (apps/web/tests/domain-boundaries.test.mts) enforces the same data-access
// boundary plus cross-domain import rules; keep the two in sync.

const EE_IMPORT_RULE = {
  patterns: [
    {
      group: ["ee", "ee/*", "@/ee/*", "~/ee/*", "**/ee/*"],
      message: "OSS code must not import commercial-only implementations from ee/.",
    },
  ],
};

// Files that may import @/lib/db directly. Everything else goes through
// lib/repositories/* (query access) or @/lib/tenant-context (tenant scoping).
const DB_BOUNDARY_INFRA_ALLOWLIST = [
  "apps/web/app/api/ready/route.ts",
  "apps/web/lib/auth-rate-limit.ts",
];

export default [
  {
    ignores: [
      "ee/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.source/**",
      "**/.worktrees/**",
      "**/target/**",
      "**/coverage/**",
      "**/storybook-static/**",
    ],
  },
  {
    // This config only enforces import boundaries; inline directives for
    // plugin rules (react-hooks, @typescript-eslint) would otherwise error.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
  },
  { files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tseslint.parser } },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: { "no-restricted-imports": ["error", EE_IMPORT_RULE] },
  },
  {
    files: ["apps/web/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          ...EE_IMPORT_RULE,
          paths: [
            {
              name: "@/lib/db",
              message:
                "Route database access through lib/repositories/*; use @/lib/tenant-context for tenant scoping.",
            },
          ],
        },
      ],
    },
  },
  {
    // Domain services own business logic and must stay ignorant of the HTTP
    // request lifecycle: no cookie/header reads, no active-scope resolution.
    // Routes/actions resolve scope at the boundary and pass an explicit
    // ActiveScope down. This mirrors the @/lib/db boundary — domains bind
    // tenancy from parameters, not from ambient request state.
    files: ["apps/web/lib/domains/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...EE_IMPORT_RULE.patterns,
            {
              group: ["next/headers"],
              message:
                "Domain services must not read request cookies/headers. Resolve scope at the route/action boundary and pass an explicit ActiveScope parameter in.",
            },
          ],
          paths: [
            {
              name: "@/lib/db",
              message:
                "Route database access through lib/repositories/*; use @/lib/tenant-context for tenant scoping.",
            },
            {
              name: "@/lib/workspace",
              importNames: ["getActiveScope"],
              message:
                "Domain services must not resolve active scope themselves. Accept an explicit ActiveScope parameter resolved at the route/action boundary (importing the ActiveScope type is fine).",
            },
            {
              name: "@/lib/workspace/scope",
              importNames: ["getActiveScope"],
              message:
                "Domain services must not resolve active scope themselves. Accept an explicit ActiveScope parameter resolved at the route/action boundary (importing the ActiveScope type is fine).",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/web/lib/repositories/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      ...DB_BOUNDARY_INFRA_ALLOWLIST,
    ],
    rules: {
      // Repositories may import @/lib/db, but the ee/ boundary still applies.
      "no-restricted-imports": ["error", EE_IMPORT_RULE],
    },
  },
  {
    // Advisory complexity guardrails (warn-level, non-blocking) so the files
    // flagged by the maintainability-complexity audit can't silently grow and
    // new regressions surface at PR time. Thresholds are generous — they catch
    // the worst offenders, not ordinary code. Generated and test files are
    // exempt because their size is not a maintenance signal.
    files: ["apps/web/{app,lib}/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx,mts,cts}",
      "**/*.gen.ts",
      "apps/web/lib/mock-data.ts",
      "packages/policy-schema/src/schema.ts",
      "packages/sdk/src/schema.ts",
      "packages/api-contracts/src/openapi.ts",
    ],
    rules: {
      complexity: ["warn", 20],
      "max-depth": ["warn", 5],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
];
