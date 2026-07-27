import { afterEach, describe, expect, it } from "vitest";
import { GET, hostFromRequest, isSiteHost } from "../app/robots.txt/route";

describe("robots.txt route", () => {
  afterEach(() => {
    delete process.env.SPCTRE_SITE_URL;
  });

  it("serves an indexable policy for spctre-site hosts", async () => {
    process.env.SPCTRE_SITE_URL = "https://spctre.dev/";

    const response = GET(new Request("https://spctre.dev/robots.txt", {
      headers: { host: "spctre-site-fyow2cpb6q-uc.a.run.app" },
    }));
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("User-agent: *\nAllow: /");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Sitemap: https://spctre.dev/sitemap.xml");
  });

  it("blocks indexing for spctre control-plane hosts", async () => {
    const response = GET(new Request("https://app.spctre.dev/robots.txt", {
      headers: { host: "spctre-fyow2cpb6q-uc.a.run.app" },
    }));
    const body = await response.text();

    expect(body).toContain("Allow: /api-docs");
    expect(body).toContain("Allow: /api/v1/openapi.json");
    expect(body).toContain("Allow: /help-docs");
    expect(body).toContain("Allow: /llms.txt");
    expect(body).toContain("Allow: /llms-full.txt");
    expect(body).toContain("Allow: /.well-known/security.txt");
    expect(body).toContain("Allow: /security.txt");
    expect(body).toContain("Disallow: /");
  });

  it("normalizes forwarded hosts before classifying the surface", () => {
    const request = new Request("https://internal.example/robots.txt", {
      headers: { "x-forwarded-host": "WWW.SPCTRE.DEV:443, internal.example" },
    });

    const host = hostFromRequest(request);

    expect(host).toBe("www.spctre.dev");
    expect(isSiteHost(host)).toBe(true);
  });
});
