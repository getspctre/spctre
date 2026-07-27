import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { toBase64Url } from "@/lib/crypto-utils";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_COOKIE = "spctre_google_state";

const cookieOptions = (maxAge: number) => ({
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge,
});

async function handleGetApiAuthGoogleAuthorize(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", request.url));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const state = toBase64Url(randomBytes(24));
  const nextParam = new URL(request.url).searchParams.get("next")?.trim();
  const safeNext = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", `${state}:${encodeURIComponent(safeNext)}`);
  authUrl.searchParams.set("access_type", "online");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, cookieOptions(60 * 10));
  return response;
}

export { handleGetApiAuthGoogleAuthorize as GET };
