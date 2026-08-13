import { randomBytes } from "crypto";
import { rawSql, sql } from "@/lib/db";
import type { AuthSession } from "@/lib/auth-session";
import { ensureDemoTenant } from "@/lib/repositories/seed/local-dev";
import {
  approveCliOnboardingRequest,
  exchangeCliOnboardingCode,
  type CliOnboardingExchange,
} from "./cli";
import { ONBOARDING_TTL_MINUTES, TRIAL_ONBOARDING_TTL_MINUTES } from "./shared";

export interface DeviceOnboardingStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type DeviceTokenResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "authorized"; exchange: CliOnboardingExchange };

export async function startDeviceOnboarding(params: {
  controlPlaneUrl: string;
  workspaceSlug?: string;
  agentId: string;
  environment: string;
  bundlePath: string;
  trial?: boolean;
}): Promise<DeviceOnboardingStart> {
  if (!rawSql) throw new Error("Database not configured.");

  const rawPart1 = randomBytes(2).toString("hex").toUpperCase();
  const rawPart2 = randomBytes(2).toString("hex").toUpperCase();
  const userCode = `SPCTRE-${rawPart1}-${rawPart2}`;
  const deviceCode = randomBytes(32).toString("base64url");
  const code = randomBytes(8).toString("base64url");
  const baseUrl = params.controlPlaneUrl.replace(/\/+$/, "");
  const isTrial = params.trial ?? false;
  // A trial request is the one that may have to wait on an account being made
  // and an email being read. See TRIAL_ONBOARDING_TTL_MINUTES.
  const ttlMinutes = isTrial ? TRIAL_ONBOARDING_TTL_MINUTES : ONBOARDING_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  await ensureDemoTenant();
  // Device authorization begins before a browser session identifies a tenant.
  // The opaque device code is stored in the RLS-excluded request table.
  await rawSql`
    INSERT INTO cli_onboarding_request (
      code, requested_workspace_slug, requested_agent_id,
      requested_environment, requested_bundle_path, control_plane_url, expires_at,
      flow_type, user_code, device_code, polling_interval_seconds, trial
    ) VALUES (
      ${code}, ${params.workspaceSlug ?? null}, ${params.agentId},
      ${params.environment}, ${params.bundlePath}, ${baseUrl}, ${expiresAt},
      'DEVICE', ${userCode}, ${deviceCode}, 5, ${isTrial}
    )
  `;

  return {
    deviceCode,
    userCode,
    verificationUri: `${baseUrl}/auth/device`,
    verificationUriComplete: `${baseUrl}/auth/device?user_code=${encodeURIComponent(userCode)}`,
    expiresIn: ttlMinutes * 60,
    interval: 5,
  };
}

export async function approveDeviceOnboarding(params: {
  userCode: string;
  session: AuthSession;
}): Promise<{ ok: true; workspaceSlug: string } | { ok: false; error: string }> {
  if (!sql) return { ok: false, error: "Database not configured." };

  const requestRows = await sql<{ code: string }[]>`
    SELECT code
    FROM cli_onboarding_request
    WHERE user_code = ${params.userCode.toUpperCase().trim()}
      AND flow_type = 'DEVICE'
      AND expires_at > now()
      AND exchanged_at IS NULL
    LIMIT 1
  `;
  const request = requestRows[0];
  if (!request) return { ok: false, error: "Device code not found or expired." };

  return approveCliOnboardingRequest({ code: request.code, session: params.session });
}

export async function exchangeDeviceCode(deviceCode: string): Promise<DeviceTokenResult> {
  if (!rawSql) throw new Error("Database not configured.");

  const rows = await rawSql<
    {
      id: string;
      code: string;
      polling_interval_seconds: number;
      last_polled_at: Date | null;
      approved_tenant_id: string | null;
      exchanged_at: Date | null;
      expires_at: Date;
    }[]
  >`
    SELECT id, code, polling_interval_seconds, last_polled_at,
           approved_tenant_id, exchanged_at, expires_at
    FROM cli_onboarding_request
    WHERE device_code = ${deviceCode}
      AND flow_type = 'DEVICE'
    LIMIT 1
  `;

  const req = rows[0];
  if (!req) return { status: "expired" };
  if (new Date(req.expires_at) <= new Date()) return { status: "expired" };
  if (req.exchanged_at) return { status: "expired" };

  if (req.last_polled_at) {
    const msSinceLastPoll = Date.now() - new Date(req.last_polled_at).getTime();
    if (msSinceLastPoll < req.polling_interval_seconds * 1000) {
      return { status: "slow_down" };
    }
  }

  await rawSql`
    UPDATE cli_onboarding_request
    SET last_polled_at = now()
    WHERE id = ${req.id}
  `;

  if (!req.approved_tenant_id) return { status: "pending" };

  const exchange = await exchangeCliOnboardingCode(req.code);
  return { status: "authorized", exchange };
}
