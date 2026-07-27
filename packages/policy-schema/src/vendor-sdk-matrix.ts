/**
 * Exact, maturity-gated vendor releases exercised by the runtime-adapter
 * compatibility test. Keep this list aligned with package.json: it is a
 * deliberate baseline, never a floating `latest` range.
 */
export const VENDOR_SDK_COMPATIBILITY_MATRIX = [
  {
    target: "mastra",
    packageName: "@mastra/core",
    version: "1.50.1",
    boundary: "Agent/Workspace beforeToolCall hook",
  },
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
  {
    target: "governance-sdk",
    packageName: "governance-sdk",
    version: "0.18.1",
    boundary: "governed-tool execute wrapper",
  },
] as const;

export type VendorSdkCompatibilityTarget = (typeof VENDOR_SDK_COMPATIBILITY_MATRIX)[number]["target"];
