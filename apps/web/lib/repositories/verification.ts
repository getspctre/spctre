import { logger } from "@spctre/platform/logging";
import type { JSONValue } from "postgres";
import { sql, rawSql } from "@/lib/db";
import type {
  AgtVerificationOutcome,
  AgtVerificationResult,
  AgtVerificationSummary,
  AgtVerificationType,
} from "@spctre/policy-schema";
import { VERIFICATION_STALE_DAYS } from "@spctre/policy-schema";

// SQL-safe nullable values for the optional ingest fields.
function verificationInsertValues(params: IngestVerificationParams) {
  return {
    revisionId: params.revisionId ?? null,
    runtimeVersion: params.runtimeVersion ?? null,
    verifierLockDigest: params.verifierLockDigest ?? null,
    verifierId: params.verifierId ?? null,
    verifierDigest: params.verifierDigest ?? null,
    policyContentHash: params.policyContentHash ?? null,
    argumentsHash: params.argumentsHash ?? null,
    approverDid: params.approverDid ?? null,
    policyVersion: params.policyVersion ?? null,
    issuedAt: params.issuedAt ?? null,
    completedAt: params.completedAt ?? null,
    agtVersion: params.agtVersion ?? null,
    agtPoliciesVersion: params.agtPoliciesVersion ?? null,
    cedarPolicyVersion: params.cedarPolicyVersion ?? null,
    policyEngineVersion: params.policyEngineVersion ?? null,
    compatibilityCheckedAt: params.compatibilityCheckedAt ?? null,
    compatibilityCheckOutcome: params.compatibilityCheckOutcome ?? null,
    escrowSignerId: params.escrowSignerId ?? null,
    escrowKeyId: params.escrowKeyId ?? null,
    outcomeHash: params.outcomeHash ?? null,
    escrowSignature: params.escrowSignature ?? null,
    escrowVerificationOutcome: params.escrowVerificationOutcome ?? null,
    escrowVerifiedAt: params.escrowVerifiedAt ?? null,
  };
}

interface IngestVerificationParams {
  tenantId: string;
  workspaceId: string;
  revisionId?: string;
  artifactHash: string;
  verificationType: AgtVerificationType;
  outcome: AgtVerificationOutcome;
  summary: Record<string, unknown>;
  runBy: string;
  runtimeVersion?: string;
  verifierLockDigest?: string;
  verifierId?: string;
  verifierDigest?: string;
  policyContentHash?: string;
  // AGT v4.0.0 additive tamper-evidence fields (spec §4.3.1)
  argumentsHash?: string;
  approverDid?: string;
  policyVersion?: string;
  issuedAt?: string;
  completedAt?: string;
  // AGT v4.1.0 policy-engine provenance and ProofOfOutcome escrow fields.
  agtVersion?: string;
  agtPoliciesVersion?: string;
  cedarPolicyVersion?: string;
  policyEngineVersion?: string;
  compatibilityCheckedAt?: string;
  compatibilityCheckOutcome?: "PASS" | "FAIL" | "WARN";
  escrowSignerId?: string;
  escrowKeyId?: string;
  outcomeHash?: string;
  escrowSignature?: string;
  escrowVerificationOutcome?: "PASS" | "FAIL" | "WARN";
  escrowVerifiedAt?: string;
}

export async function ingestVerificationResult(
  params: IngestVerificationParams,
): Promise<string | null> {
  if (!sql) return null;
  const v = verificationInsertValues(params);
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO agt_verification_result (
        tenant_id, workspace_id, revision_id, artifact_hash, verifier_lock_digest, verifier_id, verifier_digest, policy_content_hash,
        verification_type, outcome, summary, run_by, runtime_version,
        arguments_hash, approver_did, policy_version, issued_at, completed_at,
        agt_version, agt_policies_version, cedar_policy_version, policy_engine_version,
        compatibility_checked_at, compatibility_check_outcome,
        escrow_signer_id, escrow_key_id, outcome_hash, escrow_signature,
        escrow_verification_outcome, escrow_verified_at
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${v.revisionId},
        ${params.artifactHash}, ${v.verifierLockDigest}, ${v.verifierId}, ${v.verifierDigest}, ${v.policyContentHash}, ${params.verificationType}, ${params.outcome},
        ${sql.json(params.summary as JSONValue)}::jsonb, ${params.runBy}, ${v.runtimeVersion},
        ${v.argumentsHash}, ${v.approverDid}, ${v.policyVersion},
        ${v.issuedAt}, ${v.completedAt},
        ${v.agtVersion}, ${v.agtPoliciesVersion},
        ${v.cedarPolicyVersion}, ${v.policyEngineVersion},
        ${v.compatibilityCheckedAt}, ${v.compatibilityCheckOutcome},
        ${v.escrowSignerId}, ${v.escrowKeyId},
        ${v.outcomeHash}, ${v.escrowSignature},
        ${v.escrowVerificationOutcome}, ${v.escrowVerifiedAt}
      )
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error("[verification] ingest failed:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function listVerificationResults(
  workspaceId: string | null,
  tenantId: string,
  options: { revisionId?: string; artifactHash?: string; limit?: number } = {},
): Promise<AgtVerificationResult[]> {
  if (!sql) return [];
  const limit = options.limit ?? 50;
  try {
    const rows = await sql<VerificationRow[]>`
      SELECT id, tenant_id, workspace_id, revision_id, artifact_hash, verifier_lock_digest, policy_content_hash,
             verification_type, outcome, summary, run_by, runtime_version, created_at,
             arguments_hash, approver_did, policy_version, issued_at, completed_at,
             agt_version, agt_policies_version, cedar_policy_version, policy_engine_version,
             compatibility_checked_at, compatibility_check_outcome,
             escrow_signer_id, escrow_key_id, outcome_hash, escrow_signature,
             escrow_verification_outcome, escrow_verified_at
      FROM agt_verification_result
      WHERE tenant_id = ${tenantId}
        AND workspace_id = ${workspaceId}
        ${options.revisionId ? rawSql`AND revision_id = ${options.revisionId}` : rawSql``}
        ${options.artifactHash ? rawSql`AND artifact_hash = ${options.artifactHash}` : rawSql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapVerificationRow);
  } catch {
    return [];
  }
}

// Row shape for the verification-result query above; drives both mappers.
interface VerificationRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  revision_id: string | null;
  artifact_hash: string;
  verifier_lock_digest: string | null;
  policy_content_hash: string | null;
  verification_type: string;
  outcome: string;
  summary: unknown;
  run_by: string;
  runtime_version: string | null;
  created_at: Date;
  arguments_hash: string | null;
  approver_did: string | null;
  policy_version: string | null;
  issued_at: Date | null;
  completed_at: Date | null;
  agt_version: string | null;
  agt_policies_version: string | null;
  cedar_policy_version: string | null;
  policy_engine_version: string | null;
  compatibility_checked_at: Date | null;
  compatibility_check_outcome: string | null;
  escrow_signer_id: string | null;
  escrow_key_id: string | null;
  outcome_hash: string | null;
  escrow_signature: string | null;
  escrow_verification_outcome: string | null;
  escrow_verified_at: Date | null;
}

// AGT v4.x provenance and escrow fields — all optional on the result.
function mapVerificationProvenanceFields(row: VerificationRow) {
  return {
    argumentsHash: row.arguments_hash ?? undefined,
    approverDid: row.approver_did ?? undefined,
    policyVersion: row.policy_version ?? undefined,
    issuedAt: row.issued_at?.toISOString() ?? undefined,
    completedAt: row.completed_at?.toISOString() ?? undefined,
    agtVersion: row.agt_version ?? undefined,
    agtPoliciesVersion: row.agt_policies_version ?? undefined,
    cedarPolicyVersion: row.cedar_policy_version ?? undefined,
    policyEngineVersion: row.policy_engine_version ?? undefined,
    compatibilityCheckedAt: row.compatibility_checked_at?.toISOString() ?? undefined,
    compatibilityCheckOutcome: row.compatibility_check_outcome as
      AgtVerificationResult["compatibilityCheckOutcome"] | undefined,
    escrowSignerId: row.escrow_signer_id ?? undefined,
    escrowKeyId: row.escrow_key_id ?? undefined,
    outcomeHash: row.outcome_hash ?? undefined,
    escrowSignature: row.escrow_signature ?? undefined,
    escrowVerificationOutcome: row.escrow_verification_outcome as
      AgtVerificationResult["escrowVerificationOutcome"] | undefined,
    escrowVerifiedAt: row.escrow_verified_at?.toISOString() ?? undefined,
  };
}

function mapVerificationRow(row: VerificationRow): AgtVerificationResult {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    revisionId: row.revision_id ?? undefined,
    artifactHash: row.artifact_hash,
    verifierLockDigest: row.verifier_lock_digest ?? undefined,
    policyContentHash: row.policy_content_hash ?? undefined,
    verificationType: row.verification_type as AgtVerificationType,
    outcome: row.outcome as AgtVerificationOutcome,
    summary: (row.summary ?? {}) as Record<string, unknown>,
    runBy: row.run_by,
    runtimeVersion: row.runtime_version ?? undefined,
    createdAt: row.created_at.toISOString(),
    ...mapVerificationProvenanceFields(row),
  };
}

export async function getLatestVerificationStatus(
  workspaceId: string | null,
  tenantId: string,
  options: {
    revisionId?: string;
    artifactHash?: string;
    /** The verifier closure expected for this check; a result from another lock is stale. */
    verifierLockDigest?: string;
    /** Exact policy bytes expected for this check; semantic artifactHash is not enough. */
    policyContentHash?: string;
  } = {},
): Promise<AgtVerificationSummary> {
  const results = await listVerificationResults(workspaceId, tenantId, {
    revisionId: options.revisionId,
    artifactHash: options.artifactHash,
    limit: 100,
  });

  if (results.length === 0) {
    return {
      hasResults: false,
      overallOutcome: "UNKNOWN",
      isStale: false,
      staleReasons: [],
      staleThresholdDays: VERIFICATION_STALE_DAYS,
      latestRunAt: null,
      latestAgtVersion: undefined,
      latestAgtPoliciesVersion: undefined,
      latestCedarPolicyVersion: undefined,
      latestPolicyEngineVersion: undefined,
      compatibilityCheckedAt: undefined,
      compatibilityCheckOutcome: undefined,
      resultsByType: {},
    };
  }

  const resultsByType: AgtVerificationSummary["resultsByType"] = {};
  for (const r of results) {
    if (!resultsByType[r.verificationType]) {
      resultsByType[r.verificationType] = { outcome: r.outcome, createdAt: r.createdAt };
    }
  }

  const latest = results[0];
  const ageMs = Date.now() - new Date(latest.createdAt).getTime();
  const staleReasons: Array<"AGE" | "VERIFIER_LOCK" | "POLICY_CONTENT"> = [];
  if (ageMs > VERIFICATION_STALE_DAYS * 24 * 60 * 60 * 1000) staleReasons.push("AGE");
  if (options.verifierLockDigest && latest.verifierLockDigest !== options.verifierLockDigest) {
    staleReasons.push("VERIFIER_LOCK");
  }
  if (options.policyContentHash && latest.policyContentHash !== options.policyContentHash) {
    staleReasons.push("POLICY_CONTENT");
  }
  const isStale = staleReasons.length > 0;

  const outcomes = Object.values(resultsByType).map((v) => v!.outcome);
  const overallOutcome: AgtVerificationOutcome = outcomes.includes("FAIL")
    ? "FAIL"
    : outcomes.includes("WARN")
      ? "WARN"
      : "PASS";

  return {
    hasResults: true,
    overallOutcome,
    isStale,
    staleReasons,
    staleThresholdDays: VERIFICATION_STALE_DAYS,
    latestRunAt: latest.createdAt,
    latestAgtVersion: latest.agtVersion,
    latestAgtPoliciesVersion: latest.agtPoliciesVersion,
    latestCedarPolicyVersion: latest.cedarPolicyVersion,
    latestPolicyEngineVersion: latest.policyEngineVersion,
    compatibilityCheckedAt: latest.compatibilityCheckedAt,
    compatibilityCheckOutcome: latest.compatibilityCheckOutcome,
    resultsByType,
  };
}
