import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { commercialSlotModuleUrl } from "../lib/ee-adapters/slot-loader";

describe("commercial slot loader", () => {
  it("resolves slots from the standalone image root instead of a Next chunk", () => {
    expect(fileURLToPath(commercialSlotModuleUrl("web/hitl/index.js"))).toBe(
      join(process.cwd(), "ee", "web", "hitl", "index.js"),
    );
  });

  it("honors the hosted image's commercial-slot root", () => {
    const previous = process.env.SPCTRE_COMMERCIAL_SLOTS_ROOT;
    process.env.SPCTRE_COMMERCIAL_SLOTS_ROOT = "/app/ee";

    try {
      expect(fileURLToPath(commercialSlotModuleUrl("web/simulation/index.js"))).toBe(
        "/app/ee/web/simulation/index.js",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.SPCTRE_COMMERCIAL_SLOTS_ROOT;
      } else {
        process.env.SPCTRE_COMMERCIAL_SLOTS_ROOT = previous;
      }
    }
  });
});
