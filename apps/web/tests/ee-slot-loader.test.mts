import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { commercialSlotModuleUrl } from "../lib/ee-adapters/slot-loader";

describe("commercial slot loader", () => {
  it("resolves slots from the standalone image root instead of a Next chunk", () => {
    expect(fileURLToPath(commercialSlotModuleUrl("web/hitl/index.js")))
      .toBe(join(process.cwd(), "ee", "web", "hitl", "index.js"));
  });
});
