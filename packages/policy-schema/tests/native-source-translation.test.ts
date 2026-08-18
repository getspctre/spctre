import { describe, expect, it } from "vitest";
import { detectPolicySourceFormat, parsePolicySourceDocument } from "../src";

describe("native policy source translation", () => {
  it("translates the strict Cedar forbid subset with native provenance", () => {
    const result = parsePolicySourceDocument({
      sourcePath: "policies/github.cedar",
      document: 'forbid(principal, action == Action::"github.repo.delete", resource);',
    });

    expect(result.sourceFormat).toBe("CEDAR");
    expect(result.translation).toMatchObject({ status: "LOSSY", translatorVersion: "1" });
    expect(result.rules).toMatchObject([
      { effect: "DENY", connectors: ["github"], actions: ["repo.delete"], sourceFormat: "CEDAR" },
    ]);
  });

  it("rejects Cedar conditions rather than weakening them", () => {
    const result = parsePolicySourceDocument({
      sourceFormat: "CEDAR",
      document:
        'forbid(principal, action == Action::"github.repo.delete", resource) when { context.risk > 5 };',
    });

    expect(result.translation?.status).toBe("UNSUPPORTED");
    expect(result.rules).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ severity: "ERROR" });
  });

  it("rejects Cedar action ids without a registered Spctre connector prefix", () => {
    const result = parsePolicySourceDocument({
      sourceFormat: "CEDAR",
      document: 'forbid(principal, action == Action::"repo.delete", resource);',
    });

    expect(result.translation?.status).toBe("UNSUPPORTED");
    expect(result.diagnostics[0]?.message).toContain("no registered Spctre connector prefix");
  });

  it("rejects invalid source-format labels instead of selecting a translator", () => {
    const result = parsePolicySourceDocument({
      document: 'forbid(principal, action == Action::"github.repo.delete", resource);',
      sourceFormat: "cedar" as "CEDAR",
    });

    expect(result.rules).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("sourceFormat must be");
  });

  it("translates declarative Rego input selectors and blocks arbitrary expressions", () => {
    const supported = parsePolicySourceDocument({
      sourcePath: "policies/github.rego",
      document:
        'package spctre.github\ndeny if {\n input.connector == "github"\n input.action == "repo.delete"\n}',
    });
    expect(supported.translation?.status).toBe("LOSSY");
    expect(supported.rules[0]).toMatchObject({
      effect: "DENY",
      connectors: ["github"],
      actions: ["repo.delete"],
      sourceFormat: "OPA_REGO",
    });

    const unsupported = parsePolicySourceDocument({
      sourceFormat: "OPA_REGO",
      document: 'package spctre.github\ndeny if { data.roles[input.user] == "admin" }',
    });
    expect(unsupported.translation?.status).toBe("UNSUPPORTED");
    expect(unsupported.rules).toEqual([]);
  });

  it("detects native source only from native extensions or recognizable syntax", () => {
    expect(detectPolicySourceFormat({ document: "rules: []", sourcePath: "policy.yaml" })).toBe(
      "AGT_YAML",
    );
    expect(detectPolicySourceFormat({ document: "", sourcePath: "policy.rego" })).toBe("OPA_REGO");
    expect(
      detectPolicySourceFormat({
        document: 'permit(principal, action == Action::"a.b", resource);',
      }),
    ).toBe("CEDAR");
  });

  it("accepts canonical Rego module declarations and preserves comment markers in strings", () => {
    const result = parsePolicySourceDocument({
      sourceFormat: "OPA_REGO",
      document:
        'package spctre.github\nimport rego.v1\ndefault deny := false\n# a comment\ndeny if { input.connector == "github"; input.action == "a#b//c" }',
    });

    expect(result.translation?.status).toBe("LOSSY");
    expect(result.rules[0]?.actions).toEqual(["a#b//c"]);
  });

  it("accepts raw Rego backtick selector strings without stripping comment markers", () => {
    const result = parsePolicySourceDocument({
      sourceFormat: "OPA_REGO",
      document:
        "package spctre.github\nimport rego.v1\ndefault deny := false\ndeny if { input.connector == `github`; input.action == `a#b//c` } # trailing comment",
    });

    expect(result.translation?.status).toBe("LOSSY");
    expect(result.rules[0]?.actions).toEqual(["a#b//c"]);
  });

  it("preserves Cedar comment markers inside action identifiers", () => {
    const result = parsePolicySourceDocument({
      sourceFormat: "CEDAR",
      document: 'forbid(principal, action == Action::"github.a//b", resource); // comment',
    });

    expect(result.translation?.status).toBe("LOSSY");
    expect(result.rules[0]?.actions).toEqual(["a//b"]);
  });
});
