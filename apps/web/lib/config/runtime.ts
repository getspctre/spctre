import { assertTenantId } from "@/lib/tenant-id";
import { parseBooleanEnvValue } from "@/lib/platform/config";
import type { SpctrePlan } from "@/lib/feature-flags";

export type SpctreRuntimeMode = "development" | "production";

export interface RuntimeConfig {
  mode: SpctreRuntimeMode;
  plan: SpctrePlan;
  sessionGuardSecret: string | null;
  developmentSessionGuardSecret: string | null;
  demoTenantEnabled: boolean;
  singleTenantMode: boolean;
  defaultTenantId: string | null;
  e2eApiEnabled: boolean;
}

const VALID_PLANS = new Set<SpctrePlan>(["oss", "cloud", "business", "enterprise"]);
let validatedProcessConfig: RuntimeConfig | undefined;

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  return env[name]?.trim() || null;
}

function parseBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = envValue(env, name);
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be "true" or "false".`);
}

function buildRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const configuredMode = envValue(env, "SPCTRE_RUNTIME_MODE");
  if (configuredMode && configuredMode !== "development" && configuredMode !== "production") {
    throw new Error('SPCTRE_RUNTIME_MODE must be "development" or "production".');
  }
  // Existing local development remains usable, but a production Node process
  // must declare the runtime policy explicitly rather than relying on NODE_ENV.
  if (!configuredMode && env.NODE_ENV === "production") {
    throw new Error("SPCTRE_RUNTIME_MODE is required for a production runtime.");
  }
  const mode: SpctreRuntimeMode = configuredMode === "production" ? "production" : "development";

  const configuredPlan = envValue(env, "SPCTRE_PLAN") ?? "oss";
  if (!VALID_PLANS.has(configuredPlan as SpctrePlan)) {
    throw new Error('SPCTRE_PLAN must be "oss", "cloud", "business", or "enterprise".');
  }

  const sessionGuardSecret = envValue(env, "SPCTRE_SESSION_GUARD_SECRET");
  const developmentSessionGuardSecret = envValue(env, "SPCTRE_DEV_SESSION_GUARD_SECRET");
  const demoTenantEnabled = parseBoolean(env, "SPCTRE_ENABLE_DEMO_TENANT");
  const singleTenantMode = parseBoolean(env, "SPCTRE_SINGLE_TENANT_MODE");
  const defaultTenantId = envValue(env, "SPCTRE_DEFAULT_TENANT_ID");
  // Parsed leniently, matching getBooleanEnv, so this guard and the routes it
  // protects cannot disagree about whether the flag is set.
  const e2eApiEnabled = parseBooleanEnvValue(env.SPCTRE_E2E_API_ENABLED, false);

  // The E2E support API drafts, approves and publishes policy revisions outside
  // the reviewed path. It is a development affordance, so a production runtime
  // refuses to start with it enabled rather than serving it behind one flag.
  if (mode === "production" && e2eApiEnabled) {
    throw new Error("SPCTRE_E2E_API_ENABLED cannot be set in a production runtime.");
  }
  if (mode === "production" && !sessionGuardSecret) {
    throw new Error("SPCTRE_SESSION_GUARD_SECRET is required in production.");
  }
  if (mode === "production" && developmentSessionGuardSecret) {
    throw new Error("SPCTRE_DEV_SESSION_GUARD_SECRET cannot be set in production.");
  }
  if (defaultTenantId && !singleTenantMode) {
    throw new Error("SPCTRE_DEFAULT_TENANT_ID requires SPCTRE_SINGLE_TENANT_MODE=true.");
  }
  if (singleTenantMode && !defaultTenantId) {
    throw new Error("SPCTRE_SINGLE_TENANT_MODE=true requires SPCTRE_DEFAULT_TENANT_ID.");
  }
  if (defaultTenantId) assertTenantId(defaultTenantId);

  return {
    mode,
    plan: configuredPlan as SpctrePlan,
    sessionGuardSecret,
    developmentSessionGuardSecret,
    demoTenantEnabled,
    singleTenantMode,
    defaultTenantId,
    e2eApiEnabled,
  };
}

/**
 * Reads live process configuration until startup validation succeeds. Callers
 * with an injected environment always receive an uncached validation result.
 */
export function getRuntimeConfig(env?: NodeJS.ProcessEnv): RuntimeConfig {
  if (env) return buildRuntimeConfig(env);
  return validatedProcessConfig ?? buildRuntimeConfig(process.env);
}

export function validateRuntimeConfig(): RuntimeConfig {
  const config = buildRuntimeConfig(process.env);
  validatedProcessConfig = config;
  return config;
}

/** Test-only reset for suites that exercise post-startup process configuration. */
export function resetRuntimeConfigCacheForTests(): void {
  validatedProcessConfig = undefined;
}

export function isProductionRuntime(): boolean {
  return getRuntimeConfig().mode === "production";
}
