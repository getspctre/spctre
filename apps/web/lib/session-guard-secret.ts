const DEV_SESSION_GUARD_SECRET = "SPCTRE_DEV_SESSION_GUARD_SECRET";

/**
 * Resolves the single signing secret used by session-guard cookies and magic
 * links. Development must opt in with its own secret; there is deliberately no
 * built-in key that could be used to forge tenant claims.
 */
export function getSessionGuardSecret(): string {
  const configured = process.env.SPCTRE_SESSION_GUARD_SECRET?.trim();
  if (configured) return configured;

  const developmentSecret = process.env[DEV_SESSION_GUARD_SECRET]?.trim();
  if (process.env.NODE_ENV === "development" && developmentSecret) {
    return developmentSecret;
  }

  throw new Error(
    `SPCTRE_SESSION_GUARD_SECRET is required. Local development may explicitly set ${DEV_SESSION_GUARD_SECRET}.`
  );
}

/** Called from instrumentation so a production process never starts without a signing key. */
export function assertSessionGuardConfiguration(): void {
  if (process.env.NODE_ENV === "production") getSessionGuardSecret();
}
