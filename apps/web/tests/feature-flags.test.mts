import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSpctrePlan } from "../lib/feature-flags";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe("normalizeSpctrePlan", () => {
  it("logs an invalid production plan before falling back to oss", () => {
    process.env.NODE_ENV = "production";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(normalizeSpctrePlan("ent-production-typo")).toBe("oss");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Unrecognized SPCTRE_PLAN "ent-production-typo"'),
    );
  });
});
