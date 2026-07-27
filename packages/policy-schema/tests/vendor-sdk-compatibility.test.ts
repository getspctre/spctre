import { describe, expect, it } from "vitest";
import { VENDOR_SDK_COMPATIBILITY_MATRIX } from "../src/vendor-sdk-matrix";

// Keep Genkit's published surface in the typecheck without initializing its
// optional OpenTelemetry runtime. This monorepo deliberately overrides OTel
// core to v2, while Genkit 1.39 currently loads a v1-only tracing dependency.
type GenkitModule = typeof import("genkit");

describe("pinned vendor SDK compatibility matrix", () => {
  it("loads the executable adapter boundaries and resolves the Genkit API", async () => {
    const [mastra, vercelAi, governanceSdk] = await Promise.all([
      // The Agent entry point is the one exposing hooks.beforeToolCall; loading
      // the package root would also initialize optional observability plugins.
      import("@mastra/core/agent"),
      import("ai"),
      import("governance-sdk"),
    ]);

    expect(mastra.Agent).toBeTypeOf("function");
    expect(vercelAi.tool).toBeTypeOf("function");
    expect(governanceSdk.createGovernance).toBeTypeOf("function");
    const genkit: GenkitModule | undefined = undefined;
    expect(genkit).toBeUndefined();
  });

  it("pins every supported runtime adapter to an exact release", () => {
    expect(VENDOR_SDK_COMPATIBILITY_MATRIX).toEqual([
      expect.objectContaining({ target: "mastra", packageName: "@mastra/core", version: "1.50.1" }),
      expect.objectContaining({ target: "vercel-ai", packageName: "ai", version: "7.0.22" }),
      expect.objectContaining({ target: "genkit", packageName: "genkit", version: "1.39.0" }),
      expect.objectContaining({ target: "governance-sdk", packageName: "governance-sdk", version: "0.18.1" }),
    ]);
    for (const target of VENDOR_SDK_COMPATIBILITY_MATRIX) expect(target.version).not.toMatch(/[~^*]/);
  });
});
