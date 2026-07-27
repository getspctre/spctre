import { readConfig, writeConfig, type SpctreCliConfig } from "./config";

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if access token expires within 5 minutes

interface RefreshResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/**
 * Returns the current config with a valid access token, silently rotating if
 * the token is within 5 minutes of expiry. Exits the process if the refresh
 * token itself is expired — the human must run `spctre init` again.
 */
export async function refreshIfNeeded(config: SpctreCliConfig): Promise<SpctreCliConfig> {
  // Service account keys and env-injected tokens are long-lived — skip rotation.
  if (process.env.SPCTRE_API_TOKEN || config.serviceAccountMode) return config;

  const expiresAt = new Date(config.tokenExpiresAt).getTime();
  const needsRefresh = expiresAt - Date.now() < REFRESH_THRESHOLD_MS;
  if (!needsRefresh) return config;

  if (!config.refreshToken) {
    console.error(
      "Access token expired and no refresh token found. Run spctre init to reconnect."
    );
    process.exit(1);
  }

  if (config.refreshTokenExpiresAt && new Date(config.refreshTokenExpiresAt) <= new Date()) {
    console.error(
      "Refresh token expired. Run spctre init to reconnect."
    );
    process.exit(1);
  }

  const url = `${config.controlPlaneUrl.replace(/\/+$/, "")}/api/token/refresh`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: config.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Network error during refresh — keep using the existing token if it hasn't
    // expired yet, otherwise fail hard so the agent stops making unauthorised calls.
    if (Date.now() < expiresAt) return config;
    console.error(`Token refresh failed (network error): ${String(err)}`);
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    if (Date.now() < expiresAt) return config; // still valid, ignore transient error
    console.error(`Token refresh failed (${response.status}): ${body}`);
    process.exit(1);
  }

  const refreshed = (await response.json()) as RefreshResponse;
  const updated: SpctreCliConfig = {
    ...config,
    token: refreshed.accessToken,
    tokenExpiresAt: refreshed.accessTokenExpiresAt,
    refreshToken: refreshed.refreshToken,
    refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
  };

  // Best-effort write — if the file is temporarily locked or unwritable, continue anyway.
  try {
    const current = readConfig();
    if (current) {
      writeConfig({ ...current, ...updated });
    }
  } catch {
    // non-fatal
  }

  return updated;
}
