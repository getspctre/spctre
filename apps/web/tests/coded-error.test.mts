import { describe, expect, it } from "vitest";
import { CodedError, extractErrorCode, resolveErrorMessage } from "@/lib/errors/coded-error";

describe("coded-error", () => {
  it("keeps message equal to the code for log/audit invariance", () => {
    const err = new CodedError("AUTH_REQUIRED");
    expect(err.message).toBe("AUTH_REQUIRED");
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.name).toBe("CodedError");
  });

  it("recovers a code from a CodedError instance (with meta)", () => {
    const err = new CodedError("PLAN_REQUIRED", { plan: "Cloud" });
    expect(extractErrorCode(err)).toEqual({ code: "PLAN_REQUIRED", meta: { plan: "Cloud" } });
  });

  it("recovers a code from a plain envelope object (API route JSON)", () => {
    expect(extractErrorCode({ code: "POLICY_NOT_FOUND" })).toEqual({
      code: "POLICY_NOT_FOUND",
      meta: undefined,
    });
  });

  it("recovers a code from an Error whose message is a known code (server-action boundary)", () => {
    expect(extractErrorCode(new Error("INVALID_WORKSPACE"))).toEqual({ code: "INVALID_WORKSPACE" });
  });

  it("returns null for unknown codes and raw English messages", () => {
    expect(extractErrorCode(new Error("Something exploded"))).toBeNull();
    expect(extractErrorCode({ code: "NOT_A_REAL_CODE" })).toBeNull();
    expect(extractErrorCode(null)).toBeNull();
  });

  it("resolves coded errors to a localized string and passes meta", () => {
    const t = (key: string, values?: Record<string, string | number | Date>) =>
      key === "PLAN_REQUIRED" ? `needs ${values?.plan} plan` : key;
    expect(
      resolveErrorMessage(new CodedError("PLAN_REQUIRED", { plan: "Cloud" }), t, "fallback"),
    ).toBe("needs Cloud plan");
    expect(resolveErrorMessage(new CodedError("AUTH_REQUIRED"), t, "fallback")).toBe(
      "AUTH_REQUIRED",
    );
  });

  it("never passes through raw English: falls back for uncoded errors", () => {
    const t = (key: string) => key;
    expect(resolveErrorMessage(new Error("Zod: name is required"), t, "Could not save")).toBe(
      "Could not save",
    );
  });
});
