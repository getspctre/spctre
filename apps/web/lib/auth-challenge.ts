// Cookies that bind a server-side WebAuthn challenge (webauthn_challenge, see
// the repository in lib/repositories/auth/webauthn-challenge.ts) to the browser
// that started the ceremony. Each cookie holds only the opaque challenge row id;
// the challenge value, principal, and tenant live server-side and are consumed
// once. Registration and login use separate cookies so a registration challenge
// cannot be replayed against login.

export const PASSKEY_REG_CHALLENGE_COOKIE = "spctre_passkey_reg_challenge";
export const PASSKEY_LOGIN_CHALLENGE_COOKIE = "spctre_passkey_login_challenge";

export function authChallengeCookieOptions(maxAgeSeconds = 600) {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds
  };
}
