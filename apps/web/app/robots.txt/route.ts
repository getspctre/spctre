const SITE_HOSTS = new Set(["spctre.dev", "www.spctre.dev"]);

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const host = hostFromRequest(request);
  const body = isSiteHost(host) ? siteRobots() : appRobots();

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
}

export function hostFromRequest(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? new URL(request.url).host;
  return host.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
}

export function isSiteHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return SITE_HOSTS.has(normalized) || normalized.startsWith("spctre-site");
}

function appRobots(): string {
  return lines([
    "User-agent: *",
    "Allow: /api-docs",
    "Allow: /api/v1/openapi.json",
    "Allow: /help-docs",
    "Allow: /llms.txt",
    "Allow: /llms-full.txt",
    "Allow: /.well-known/security.txt",
    "Allow: /security.txt",
    "Disallow: /",
    "",
    "# Spctre control-plane routes are tenant and workspace scoped.",
    "# Public API docs and schema routes are available for agents."
  ]);
}

function siteRobots(): string {
  const siteUrl = originFromEnv("SPCTRE_SITE_URL", "https://spctre.dev");

  return lines([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /account/",
    "Disallow: /admin/",
    "Disallow: /auth/",
    "Disallow: /login/",
    "Disallow: /signup/",
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`
  ]);
}

function originFromEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim() || fallback;
  return raw.replace(/\/+$/, "");
}

function lines(values: string[]): string {
  return `${values.join("\n")}\n`;
}
