/**
 * Exact, maturity-gated vendor releases exercised by the runtime-adapter
 * compatibility test. Keep this list aligned with package.json: it is a
 * deliberate baseline, never a floating `latest` range. Dependency-free
 * adapters for runtimes not listed here remain available, but are not pinned
 * as executable third-party compatibility fixtures.
 */
export const VENDOR_SDK_COMPATIBILITY_MATRIX = [
  {
    target: "vercel-ai",
    packageName: "ai",
    version: "7.0.22",
    boundary: "tool execute wrapper",
  },
  {
    target: "genkit",
    packageName: "genkit",
    version: "1.39.0",
    boundary: "defineTool implementation wrapper",
  },
] as const;

export type VendorSdkCompatibilityTarget = (typeof VENDOR_SDK_COMPATIBILITY_MATRIX)[number]["target"];
