import axios from "axios";
import { errorMessage } from "./handlers/context.js";
import { incrementCounter, logger, withSpan } from "./observability.js";

export const REFRESH_MAX_ATTEMPTS = 3;
export const REFRESH_BACKOFF_BASE_MS = 1_000;
export const AXIOS_TIMEOUT_MS = 10_000;

// Reads an axios-style `{ response: { status, data } }` off an unknown thrown
// value structurally, so it does not depend on axios.isAxiosError at runtime.
function axiosErrorResponse(err: unknown): { status?: number; data?: unknown } | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: unknown }).response;
    if (response && typeof response === "object") {
      return response as { status?: number; data?: unknown };
    }
  }
  return undefined;
}

export interface TokenRefreshResponse {
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
}

export type TokenErrorKind =
  | "token_revoked"
  | "token_expired"
  | "no_refresh_token"
  | "refresh_network_error"
  | "refresh_failed";

export class TokenLifecycleError extends Error {
  readonly kind: TokenErrorKind;
  constructor(kind: TokenErrorKind, message: string) {
    super(message);
    this.name = "TokenLifecycleError";
    this.kind = kind;
  }
}

export function emitTokenEvent(event: string, detail: Record<string, unknown>): void {
  logger.info("MCP token event", { event, ...detail });
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class AccessTokenManager {
  private accessToken?: string;
  private refreshToken?: string;
  private expiresAtMs = 0;
  private canRevokeAccessToken = false;
  private readonly apiBaseUrl: string;
  // Single-flight guard: when the token is expiring, every concurrent tool call
  // would otherwise call refresh() independently. Because refresh tokens rotate
  // on use, the first refresh to land invalidates the token the racers are still
  // submitting, which the server can treat as replay of a revoked token and kill
  // the session. Memoizing the in-flight promise makes concurrent callers share
  // one refresh and one atomic update of accessToken/refreshToken.
  private refreshPromise?: Promise<void>;

  constructor(params: { apiBaseUrl: string; accessToken?: string; refreshToken?: string }) {
    this.apiBaseUrl = params.apiBaseUrl;
    this.accessToken = params.accessToken?.trim() || undefined;
    this.refreshToken = params.refreshToken?.trim() || undefined;
  }

  async getValidAccessToken(): Promise<string> {
    if (this.accessToken && !this.isExpiringSoon()) {
      return this.accessToken;
    }

    if (!this.refreshToken) {
      emitTokenEvent("token.expired_no_refresh", {});
      throw new TokenLifecycleError("no_refresh_token", "No valid access token and no refresh token configured.");
    }

    await this.refresh();

    if (!this.accessToken) {
      throw new TokenLifecycleError("refresh_failed", "Failed to refresh access token.");
    }

    return this.accessToken;
  }

  async refresh(): Promise<void> {
    // Share a single in-flight refresh across concurrent callers; clear the slot
    // once it settles (success or failure) so the next expiry triggers a fresh one.
    this.refreshPromise ??= this.runRefresh().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async runRefresh(): Promise<void> {
    await withSpan("mcp.token.refresh", { "spctre.api_base_url": this.apiBaseUrl }, async () => {
      await this.refreshWithRetry();
    });
  }

  private applyRefreshResponse(data: TokenRefreshResponse, attempt: number): void {
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken || this.refreshToken;
    this.canRevokeAccessToken = true;
    this.expiresAtMs = data.accessTokenExpiresAt
      ? Date.parse(data.accessTokenExpiresAt)
      : Date.now() + 55 * 60 * 1000;

    emitTokenEvent("token.refresh_ok", { attempt, expires_at: new Date(this.expiresAtMs).toISOString() });
    incrementCounter("spctre.token.refresh", 1, { service: "mcp", outcome: "success" });
  }

  // A 401 means the refresh token itself is dead — retrying cannot help.
  private throwPermanentRefreshFailure(err: unknown, status: number, attempt: number): never {
    const body = axiosErrorResponse(err)?.data as Record<string, unknown> | undefined;
    const isRevoked = String(body?.error ?? "").toLowerCase().includes("revoked");
    const kind: TokenErrorKind = isRevoked ? "token_revoked" : "token_expired";
    emitTokenEvent("token.refresh_permanent_failure", { attempt, status, kind });
    incrementCounter("spctre.token.refresh", 1, { service: "mcp", outcome: kind });
    throw new TokenLifecycleError(kind, `Token refresh rejected by server (${status}): ${body?.error ?? errorMessage(err)}`);
  }

  private async refreshWithRetry(): Promise<void> {
    if (!this.refreshToken) {
      incrementCounter("spctre.token.refresh", 1, { service: "mcp", outcome: "no_refresh_token" });
      throw new TokenLifecycleError("no_refresh_token", "Cannot refresh: refresh token not configured.");
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
      try {
        const response: import("axios").AxiosResponse<TokenRefreshResponse> = await axios.post<TokenRefreshResponse>(
          `${this.apiBaseUrl}/api/token/refresh`,
          { refreshToken: this.refreshToken },
          { headers: { "Content-Type": "application/json" }, timeout: AXIOS_TIMEOUT_MS }
        );

        this.applyRefreshResponse(response.data, attempt);
        return;
      } catch (err) {
        lastErr = err;
        const status: number | undefined = axiosErrorResponse(err)?.status;

        if (status === 401) {
          this.throwPermanentRefreshFailure(err, status, attempt);
        }

        const backoffMs = REFRESH_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        emitTokenEvent("token.refresh_retrying", { attempt, max_attempts: REFRESH_MAX_ATTEMPTS, backoff_ms: backoffMs, error: errorMessage(err) });

        if (attempt < REFRESH_MAX_ATTEMPTS) {
          await sleepMs(backoffMs);
        }
      }
    }

    emitTokenEvent("token.refresh_exhausted", { attempts: REFRESH_MAX_ATTEMPTS, error: errorMessage(lastErr) });
    incrementCounter("spctre.token.refresh", 1, { service: "mcp", outcome: "refresh_network_error" });
    throw new TokenLifecycleError("refresh_network_error", `Token refresh failed after ${REFRESH_MAX_ATTEMPTS} attempts: ${errorMessage(lastErr)}`);
  }

  async revokeBestEffort(): Promise<void> {
    await withSpan("mcp.token.revoke", { "spctre.api_base_url": this.apiBaseUrl }, async () => {
      if (!this.accessToken || !this.canRevokeAccessToken) {
        return;
      }

      try {
        await axios.post(`${this.apiBaseUrl}/api/token/revoke`, undefined, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          timeout: AXIOS_TIMEOUT_MS,
        });
        emitTokenEvent("token.revoked", { reason: "server_close" });
        incrementCounter("spctre.token.revoke", 1, { service: "mcp", outcome: "success" });
      } catch (err) {
        emitTokenEvent("token.revoke_failed", { error: errorMessage(err) });
        incrementCounter("spctre.token.revoke", 1, { service: "mcp", outcome: "failure" });
        // Best effort only — do not throw.
      }
    });
  }

  private isExpiringSoon(): boolean {
    if (!this.expiresAtMs) {
      return false;
    }
    return Date.now() >= this.expiresAtMs - 60_000;
  }
}
