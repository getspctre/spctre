import { describe, expect, it } from "vitest";
import { GET as canonicalGet } from "../app/.well-known/security.txt/route";
import { GET as rootGet } from "../app/security.txt/route";

describe("security.txt routes", () => {
  it("serves the canonical security disclosure metadata", async () => {
    const response = canonicalGet();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(body).toContain("Contact: mailto:security@spctre.dev");
    expect(body).toContain("Policy: https://github.com/spctre/spctre/security/policy");
    expect(body).toContain("Canonical: https://spctre.dev/.well-known/security.txt");
    expect(body).toContain("Preferred-Languages: en");
  });

  it("serves the same file from /security.txt for compatibility", async () => {
    const canonicalBody = await canonicalGet().text();
    const rootBody = await rootGet().text();

    expect(rootBody).toBe(canonicalBody);
  });
});
