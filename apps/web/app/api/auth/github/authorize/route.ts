import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { toBase64Url } from "@/lib/crypto-utils";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const STATE_COOKIE = "spctre_github_state";

const cookieOptions = (maxAge: number) => ({
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge,
});

async function handleGetApiAuthGithubAuthorize(request: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=github_not_configured", request.url));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  const state = toBase64Url(randomBytes(24));
  const nextParam = new URL(request.url).searchParams.get("next")?.trim();
  const safeNext = nextParam && nextParam.startsWith("/") ? nextParam : "/";

  const authUrl = new URL(GITHUB_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read:user user:email");
  authUrl.searchParams.set("state", `${state}:${encodeURIComponent(safeNext)}`);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, cookieOptions(60 * 10));
  return response;
}

export { handleGetApiAuthGithubAuthorize as GET };
