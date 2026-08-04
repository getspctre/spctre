"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { evaluateDecision } from "@spctre/policy-schema";
import type { PolicyRuleSummary } from "@spctre/policy-schema";
import { getWorkspaceContext } from "@/lib/workspace";
import { getActiveActor, requireActorAdminWorkspace } from "@/lib/actors";
import { recordAuthOperation } from "@/lib/domains/auth/service";
import {
  ensureStarterPublishedBundle,
  recordWebOnboardingMilestone,
  WEB_ONBOARDING_TOKEN_LABEL,
  WEB_ONBOARDING_TOKEN_SCOPES,
} from "@/lib/repositories/onboarding/shared";
import { insertRuntimeEvidenceWithDedup } from "@/lib/repositories/evidence/runtime";
import { issueServiceAccountKey } from "@/lib/service-tokens";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { swallow } from "@/lib/platform/swallow";

export type QuickStartState = { error: string } | null;
export type SetupTokenState =
  | { ok: true; rawToken: string; tokenPrefix: string; error?: never }
  | { ok?: never; rawToken?: never; tokenPrefix?: never; error: string }
  | null;

const STARTER_RULES: PolicyRuleSummary[] = [
  {
    stableRuleId: "system.heartbeat",
    title: "Accept runtime heartbeats from connected agents",
    effect: "ALLOW",
    sourceFormat: "AGT_YAML",
    domains: ["operations"],
    connectors: ["system"],
    actions: ["heartbeat"],
    immutable: false,
  },
  {
    stableRuleId: "sample.event.allow",
    title: "Allow sample onboarding events",
    effect: "ALLOW",
    sourceFormat: "AGT_YAML",
    domains: ["onboarding"],
    connectors: ["sample"],
    actions: ["event.register"],
    immutable: false,
  },
  {
    stableRuleId: "sample.payment.block",
    title: "Block high-risk payment actions (sample)",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    domains: ["finance"],
    connectors: ["sample"],
    actions: ["payment.create"],
    immutable: false,
  },
];

async function fireStarterDecision(
  connector: string,
  action: string,
  domains: string[],
): Promise<{ decisionId: string; redirectPath: string } | { error: string }> {
  try {
    const workspaceContext = await getWorkspaceContext();
    const { tenantId, workspaceId, workspaceSlug } = workspaceContext;
    const writeCheck = verifyWriteAccess(tenantId);
    if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

    const { actor } = await getActiveActor({ workspaceId, tenantId });

    const starter = await ensureStarterPublishedBundle({
      tenantId,
      workspaceId,
      actorId: actor.id,
      environment: "development",
    });

    const result = evaluateDecision({ connector, action, domains, rules: STARTER_RULES });
    const decisionId = randomUUID();

    await insertRuntimeEvidenceWithDedup({
      tenantId,
      workspaceId,
      evidence: {
        decisionId,
        tenantId,
        workspaceId,
        environment: "development",
        runtimeTarget: { stack: "LOCAL", adapter: "spctre-quickstart" },
        agentId: "my-first-agent",
        connector,
        action,
        status: result.status,
        reason: result.reason,
        policyRefs: result.matchedRefs,
        artifactHash: starter.artifactHash,
        policyContext: [
          {
            scope: "WORKSPACE",
            branchId: starter.branchId,
            revisionId: starter.revisionId,
            artifactHash: starter.artifactHash,
          },
        ],
        latencyMs: 1,
        createdAt: new Date().toISOString(),
        rawEvidence: { _source: "quickstart" },
      },
      rawEvidenceWithSource: {
        connector,
        action,
        agentId: "my-first-agent",
        environment: "development",
        artifactHash: starter.artifactHash,
        _source: "quickstart",
      },
      executionTrace: null,
      engineVersion: null,
    });

    await recordWebOnboardingMilestone({
      tenantId,
      workspaceId,
      milestone: "sample_decision_sent",
      metadata: { connector, action, decisionId, source: "quick_start_action" },
    });

    const evidencePath = buildWorkspacePath(workspaceSlug, "/evidence");
    return {
      decisionId,
      redirectPath: `${evidencePath}?highlight=${encodeURIComponent(decisionId)}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function sendAllowedDecision(
  _prev: QuickStartState,
  _formData: FormData,
): Promise<QuickStartState> {
  const result = await fireStarterDecision("sample", "event.register", ["onboarding"]);
  if ("error" in result) return { error: result.error };
  redirect(result.redirectPath);
}

export async function sendBlockedDecision(
  _prev: QuickStartState,
  _formData: FormData,
): Promise<QuickStartState> {
  const result = await fireStarterDecision("sample", "payment.create", ["finance"]);
  if ("error" in result) return { error: result.error };
  redirect(result.redirectPath);
}

export async function generateOnboardingSetupToken(
  _prev: SetupTokenState,
  _formData: FormData,
): Promise<SetupTokenState> {
  try {
    const workspaceContext = await getWorkspaceContext();
    const { tenantId, workspaceId, workspaceSlug } = workspaceContext;
    const { actor } = await getActiveActor({ workspaceId, tenantId });
    const adminCheck = requireActorAdminWorkspace(actor, workspaceSlug);
    if (!adminCheck.allowed) return { error: adminCheck.reason };

    const writeCheck = verifyWriteAccess(tenantId);
    if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

    const result = await issueServiceAccountKey({
      tenantId,
      workspaceId,
      principalId: actor.id,
      createdBy: actor.id,
      label: WEB_ONBOARDING_TOKEN_LABEL,
      scopes: WEB_ONBOARDING_TOKEN_SCOPES,
      expiresInDays: 30,
    });

    recordAuthOperation({
      tenantId,
      workspaceId,
      eventType: "TOKEN_ISSUED",
      sourceId: result.tokenId,
      sourceTable: "service_token",
      actorId: actor.id,
      payload: {
        label: WEB_ONBOARDING_TOKEN_LABEL,
        scopes: result.scopes,
        keyType: "API_KEY",
        source: "web_onboarding",
        expiresInDays: 30,
      },
    }).catch(swallow("recordAuthOperation", undefined));

    await recordWebOnboardingMilestone({
      tenantId,
      workspaceId,
      milestone: "setup_token_generated",
      metadata: {
        source: "setup_token_action",
        tokenPrefix: result.tokenPrefix,
        scopes: result.scopes,
        expiresInDays: 30,
      },
    });

    revalidatePath(buildWorkspacePath(workspaceSlug, "/"));
    revalidatePath(buildWorkspacePath(workspaceSlug, "/agents"));
    revalidatePath(buildWorkspacePath(workspaceSlug, "/evidence"));

    return { ok: true, rawToken: result.rawToken, tokenPrefix: result.tokenPrefix };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not generate setup token." };
  }
}
