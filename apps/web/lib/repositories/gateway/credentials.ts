import { logger } from "@spctre/platform/logging";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

interface CredentialGrant {
  credentialType: string;
  injectedParameter: string;
  credentialValue: string;
  expiresAt: string;
}

export interface CredentialBroker {
  id: string;
  credentialType: "STRIPE_RESTRICTED" | "MOCK";
  injectedParameter: string;
  brokerConfig: Record<string, unknown>;
}

export async function findCredentialBroker(params: {
  tenantId: string;
  workspaceId: string;
  connector: string;
  action: string;
}): Promise<CredentialBroker | null> {
  if (!sql) return null;

  try {
    const rows = await sql<{
      id: string;
      credential_type: CredentialBroker["credentialType"];
      injected_parameter: string;
      broker_config: Record<string, unknown>;
    }[]>`
      SELECT id, credential_type, injected_parameter, broker_config
      FROM gateway_credential_broker
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND connector = ${params.connector}
        AND (action = ${params.action} OR action = '*')
      ORDER BY action DESC -- prioritize exact action match over '*'
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      credentialType: row.credential_type,
      injectedParameter: row.injected_parameter,
      brokerConfig: row.broker_config,
    };
  } catch {
    return null;
  }
}

type GrantInsertResult = "inserted" | "already_issued" | "error";

async function createCredentialGrant(params: {
  tenantId: string;
  workspaceId: string;
  gatewayDecisionId: string;
  brokerId: string;
  injectedParameter: string;
  expiresAt: Date;
}): Promise<GrantInsertResult> {
  if (!sql) return "error";

  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gateway_credential_grant (
        tenant_id, workspace_id, gateway_decision_id, broker_id, injected_parameter, expires_at
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.gatewayDecisionId}, ${params.brokerId}, ${params.injectedParameter}, ${params.expiresAt}
      )
      ON CONFLICT (gateway_decision_id) DO NOTHING
      RETURNING id
    `;
    return rows.length > 0 ? "inserted" : "already_issued";
  } catch (err) {
    logger.error("[gateway/credentials] failed to create credential grant:", { error: err instanceof Error ? err.message : String(err) });
    return "error";
  }
}

export type BrokerResult =
  | { status: "granted"; grant: CredentialGrant }
  | { status: "already_issued" }
  | { status: "error" };

function credentialSuffix(): string {
  return randomBytes(16).toString("hex");
}

export async function brokerCredential(
  broker: CredentialBroker,
  params: {
    tenantId: string;
    workspaceId: string;
    gatewayDecisionId: string;
  }
): Promise<BrokerResult> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes lifetime
  let credentialValue = "";

  if (broker.credentialType === "STRIPE_RESTRICTED") {
    credentialValue = `rk_test_jit_${credentialSuffix()}`;
  } else if (broker.credentialType === "MOCK") {
    credentialValue = `ephemeral-mock-token-${credentialSuffix()}`;
  } else {
    return { status: "error" };
  }

  if (!credentialValue) return { status: "error" };

  const insertResult = await createCredentialGrant({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    gatewayDecisionId: params.gatewayDecisionId,
    brokerId: broker.id,
    injectedParameter: broker.injectedParameter,
    expiresAt,
  });

  if (insertResult === "already_issued") return { status: "already_issued" };
  if (insertResult === "error") return { status: "error" };

  return {
    status: "granted",
    grant: {
      credentialType: broker.credentialType,
      injectedParameter: broker.injectedParameter,
      credentialValue,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function hasCredentialGrantBeenIssued(
  gatewayDecisionId: string,
  tenantId: string
): Promise<boolean> {
  if (!sql) return false;

  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text as count
      FROM gateway_credential_grant
      WHERE tenant_id = ${tenantId}
        AND gateway_decision_id = ${gatewayDecisionId}
    `;
    return parseInt(rows[0]?.count ?? "0", 10) > 0;
  } catch (err) {
    logger.error("[gateway/credentials] failed to check if credential grant has been issued:", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function hasCredentialGrantBeenIssuedByDecisionId(
  decisionId: string,
  tenantId: string
): Promise<boolean> {
  if (!sql) return false;

  try {
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text as count
      FROM gateway_credential_grant gcg
      JOIN gateway_decision gd ON gd.id = gcg.gateway_decision_id
      WHERE gd.tenant_id = ${tenantId}
        AND gd.decision_id = ${decisionId}
    `;
    return parseInt(rows[0]?.count ?? "0", 10) > 0;
  } catch (err) {
    logger.error("[gateway/credentials] failed to check if credential grant has been issued by decision id:", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
