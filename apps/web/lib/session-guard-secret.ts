import { getRuntimeConfig } from "@/lib/config/runtime";

/**
 * Resolves the single signing secret used by session-guard cookies and magic
 * links. Development must opt in with its own secret; there is deliberately no
 * built-in key that could be used to forge tenant claims.
 */
export function getSessionGuardSecret(): string {
  const config = getRuntimeConfig();
  if (config.sessionGuardSecret) return config.sessionGuardSecret;
  if (config.mode === "development" && config.developmentSessionGuardSecret)
    return config.developmentSessionGuardSecret;

  throw new Error(
    "SPCTRE_SESSION_GUARD_SECRET is required. Local development may explicitly set SPCTRE_DEV_SESSION_GUARD_SECRET.",
  );
}

/** Called from instrumentation so a production process never starts without a signing key. */
export function assertSessionGuardConfiguration(): void {
  getSessionGuardSecret();
}
