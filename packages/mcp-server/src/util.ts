import type { Request } from "express";

// Small stateless parsing helpers shared by the transport bootstrap and config
// loading. Extracted from the former monolithic index.ts (maintainability audit
// Hotspot 1) so the composition root stays free of parsing minutiae.

export function parseCsv(value: string | undefined): string[] | undefined {
  const entries = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

export function parseBearerFromAuthHeader(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return undefined;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || undefined;
}

export function parseAllowedSourceIps(): Set<string> {
  return new Set(
    (process.env.SPCTRE_ALLOWED_SOURCE_IPS || "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean)
  );
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || req.ip || req.socket.remoteAddress || "";
}
