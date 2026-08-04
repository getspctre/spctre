import { NextResponse } from "next/server";
import {
  finalizeOAuthCallback,
  loginRedirect,
  validateOAuthCallback,
  type OAuthCallbackValidation,
  type OAuthIdentity,
} from "@/lib/domains/auth/oauth-callback";
import { fetchWithTimeout } from "@/lib/platform/fetch-timeout";

const STATE_COOKIE = "spctre_github_state";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

interface GithubUser {
  id?: number;
  login?: string;
  name?: string | null;
  email?: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

// Exchange the OAuth code, then fetch the GitHub user and a verified email.
type VerifiedGithubUser = GithubUser & { id: number; login: string };

async function resolveGithubIdentity(
  request: Request,
  params: { code: string; clientId: string; clientSecret: string },
): Promise<OAuthIdentity | NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/auth/github/callback`;

  const tokenRes = await fetchWithTimeout(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    return loginRedirect(request, "token_exchange_failed");
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenBody.access_token;
  if (!accessToken) {
    return loginRedirect(request, "missing_access_token");
  }

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  const [userRes, emailsRes] = await Promise.all([
    fetchWithTimeout(GITHUB_USER_URL, { headers: authHeaders, cache: "no-store" }),
    fetchWithTimeout(GITHUB_EMAILS_URL, { headers: authHeaders, cache: "no-store" }),
  ]);

  if (!userRes.ok) {
    return loginRedirect(request, "github_user_fetch_failed");
  }

  const githubUser = (await userRes.json()) as GithubUser;
  if (!githubUser.id || !githubUser.login) {
    return loginRedirect(request, "invalid_github_user");
  }

  let email: string | null = null;
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as GithubEmail[];
    email =
      emails.find((e) => e.primary && e.verified)?.email ??
      emails.find((e) => e.verified)?.email ??
      null;
  }

  if (!email) {
    return loginRedirect(request, "github_verified_email_required");
  }

  return {
    provider: "GITHUB",
    subject: String((githubUser as VerifiedGithubUser).id),
    email,
    displayName: githubUser.name?.trim() || (githubUser as VerifiedGithubUser).login,
  };
}

async function handleGetApiAuthGithubCallback(request: Request) {
  const validated = validateOAuthCallback(request, {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    notConfiguredError: "github_not_configured",
    stateCookie: STATE_COOKIE,
  });
  if (validated instanceof NextResponse) return validated;
  const { safeNext } = validated;

  const identity = await resolveGithubIdentity(
    request,
    validated satisfies OAuthCallbackValidation,
  );
  if (identity instanceof NextResponse) return identity;

  return finalizeOAuthCallback({
    request,
    identity,
    stateCookie: STATE_COOKIE,
    logPrefix: "[github-callback]",
    safeNext,
  });
}

export { handleGetApiAuthGithubCallback as GET };
