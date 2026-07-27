import { randomBytes } from "crypto";

export const PASSKEY_REG_CHALLENGE_COOKIE = "spctre_passkey_reg_challenge";
export const PASSKEY_LOGIN_CHALLENGE_COOKIE = "spctre_passkey_login_challenge";
export const PASSKEY_LOGIN_PRINCIPAL_COOKIE = "spctre_passkey_login_principal";
export const PASSKEY_LOGIN_TENANT_COOKIE = "spctre_passkey_login_tenant";

export function authChallengeCookieOptions(maxAgeSeconds = 600) {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds
  };
}

export function createChallenge(length = 32): string {
  return randomBytes(length)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
