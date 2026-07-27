import * as fs from "node:fs";
import * as path from "node:path";
import type { RuntimePolicyContext } from "@spctre/policy-schema";

export interface SpctreCliConfig {
  controlPlaneUrl: string;
  tenantId: string;
  workspaceId: string;
  workspaceSlug: string;
  agentId: string;
  environment: string;
  token: string;
  tokenId: string;
  tokenExpiresAt: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  artifactHash: string;
  branchId: string;
  revisionId: string;
  bundlePath: string;
  policyContext: RuntimePolicyContext[];
  blueprintRevisionId?: string;
  blueprintDefinitionHash?: string;
  blueprintPath?: string;
  serviceAccountMode?: boolean;
  gatewayUrl?: string;
  gatewayOutagePolicy?: "fail-open" | "fail-closed";
  locale?: string;
}

export function configPath() {
  const base = process.env.SPCTRE_CONFIG_DIR
    ? path.resolve(process.env.SPCTRE_CONFIG_DIR)
    : path.resolve(process.cwd(), ".spctre");
  return path.join(base, "config.json");
}

export function defaultConfig(): SpctreCliConfig {
  return {
    controlPlaneUrl: "http://localhost:3000",
    tenantId: "",
    workspaceId: "",
    workspaceSlug: "",
    agentId: "",
    environment: "dev",
    token: "",
    tokenId: "",
    tokenExpiresAt: "",
    artifactHash: "",
    branchId: "",
    revisionId: "",
    bundlePath: "",
    policyContext: [],
  };
}

export function readStoredConfig(): SpctreCliConfig | null {
  const target = configPath();
  if (!fs.existsSync(target)) return null;

  try {
    return { ...defaultConfig(), ...(JSON.parse(fs.readFileSync(target, "utf8")) as Partial<SpctreCliConfig>) };
  } catch {
    return null;
  }
}

export function readConfig(): SpctreCliConfig | null {
  const target = configPath();
  const exists = fs.existsSync(target);
  if (!exists && !process.env.SPCTRE_API_TOKEN && !process.env.SPCTRE_API_TOKEN_FILE) {
    return null;
  }

  let config = defaultConfig();

  if (exists) {
    config = readStoredConfig() ?? config;
  }

  return applyEnvOverrides(config);
}

export function writeConfig(config: SpctreCliConfig) {
  const target = configPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
}

export function requireConfig(): SpctreCliConfig {
  const config = readConfig();
  if (!config) {
    const ciHint = process.env.CI === "true"
      ? " In CI, set SPCTRE_API_TOKEN + SPCTRE_WORKSPACE and run: spctre init --token <key> --workspace <slug>"
      : "";
    console.error(`Error: No .spctre/config.json found. Run spctre init first.${ciHint}`);
    process.exit(1);
  }
  return config;
}

/**
 * Overlays SPCTRE_* environment variables onto a config object.
 * Env vars take precedence over the file-based config and are never written
 * back to disk — the caller owns the lifecycle of env-injected tokens.
 *
 * Token resolution order (highest to lowest priority):
 *   SPCTRE_API_TOKEN env var → SPCTRE_API_TOKEN_FILE file contents → config.json token
 *
 * When SPCTRE_API_TOKEN_FILE supplies the token, serviceAccountMode is set to true
 * so the refresh loop skips rotation (file-sourced keys are long-lived).
 */
function applyEnvOverrides(config: SpctreCliConfig): SpctreCliConfig {
  let token = config.token;
  let serviceAccountMode = config.serviceAccountMode;

  if (process.env.SPCTRE_API_TOKEN) {
    token = process.env.SPCTRE_API_TOKEN;
  } else if (process.env.SPCTRE_API_TOKEN_FILE) {
    try {
      token = fs.readFileSync(process.env.SPCTRE_API_TOKEN_FILE, "utf8").trim();
      serviceAccountMode = true;
    } catch {
      // Unreadable token file — fall through to config.json token.
    }
  }

  return {
    ...config,
    token,
    serviceAccountMode,
    ...(process.env.SPCTRE_URL ? { controlPlaneUrl: process.env.SPCTRE_URL } : {}),
    ...(process.env.SPCTRE_GATEWAY_URL ? { gatewayUrl: process.env.SPCTRE_GATEWAY_URL } : {}),
    ...(process.env.SPCTRE_GATEWAY_OUTAGE_POLICY ? { gatewayOutagePolicy: process.env.SPCTRE_GATEWAY_OUTAGE_POLICY as SpctreCliConfig["gatewayOutagePolicy"] } : {}),
    ...(process.env.SPCTRE_WORKSPACE ? { workspaceId: process.env.SPCTRE_WORKSPACE } : {}),
    ...(process.env.SPCTRE_AGENT ? { agentId: process.env.SPCTRE_AGENT } : {}),
    ...(process.env.SPCTRE_BUNDLE_PATH ? { bundlePath: process.env.SPCTRE_BUNDLE_PATH } : {}),
  };
}
