import {
  getHighFrictionRules,
  getUnusedActiveRules,
  getReviewArtifacts,
} from "@/lib/repositories/policy";
import { listPostureRuleRows, type PostureRuleRow } from "@/lib/repositories/posture";
import { getLatestPublishedBundle } from "@/lib/repositories/policy/publish";
import { getRulesForRevision } from "@/lib/repositories/policy/rules";
import { listAgentSummaries } from "@/lib/repositories/evidence";
import { swallow } from "@/lib/platform/swallow";

export type PostureDimension = "CONTROL_HEALTH" | "SCOPE_INTEGRITY" | "OPERATIONAL_EFFICIENCY";
export type PostureSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface PostureFinding {
  id: string;
  dimension: PostureDimension;
  severity: PostureSeverity;
  title: string;
  detail: string;
  affectedScope: string;
  action: { label: string; href: string };
}

export interface PostureModel {
  status: "READY" | "ATTENTION" | "AT_RISK";
  summary: string;
  findings: PostureFinding[];
  dimensions: Array<{
    id: PostureDimension;
    label: string;
    status: "READY" | "ATTENTION" | "AT_RISK";
    detail: string;
  }>;
}

function signature(rule: PostureRuleRow) {
  return JSON.stringify({
    title: rule.title,
    effect: rule.effect,
    domains: [...rule.domains].sort(),
    connectors: [...rule.connectors].sort(),
    actions: [...rule.actions].sort(),
    immutable: rule.immutable,
  });
}

function severityRank(severity: PostureSeverity) {
  return severity === "HIGH" ? 0 : severity === "MEDIUM" ? 1 : 2;
}

export async function getPostureModel(params: {
  tenantId: string;
  workspaceId: string;
  workspaceSlug: string;
}): Promise<PostureModel> {
  const [baseline, friction, unused, agents, published] = await Promise.all([
    listPostureRuleRows(params.tenantId).catch(
      swallow("listPostureRuleRows", { orgRules: [], workspaceRules: [], workspaceCount: 0 }),
    ),
    getHighFrictionRules(25, params.workspaceId, params.tenantId).catch(
      swallow("getHighFrictionRules", []),
    ),
    getUnusedActiveRules(params.workspaceId, params.tenantId).catch(
      swallow("getUnusedActiveRules", []),
    ),
    listAgentSummaries(params.workspaceId, params.tenantId).catch(
      swallow("listAgentSummaries", []),
    ),
    getLatestPublishedBundle(params.workspaceId, params.tenantId).catch(
      swallow("getLatestPublishedBundle", null),
    ),
  ]);
  const publishedRules = published
    ? await getRulesForRevision(published.revisionId, params.tenantId).catch(
        swallow("getRulesForRevision", []),
      )
    : [];
  const composition = published
    ? await getReviewArtifacts(
        published.branchId,
        published.revisionId,
        params.workspaceId,
        params.tenantId,
      ).catch(swallow("getReviewArtifacts", null))
    : null;
  const baselineById = new Map(baseline.orgRules.map((rule) => [rule.stableRuleId, rule]));
  const drift = baseline.workspaceRules.filter((rule) => {
    const orgRule = baselineById.get(rule.stableRuleId);
    return !orgRule || signature(rule) !== signature(orgRule);
  });
  const ungoverned = agents.filter(
    (agent) =>
      !agent.latestPublishedHash || agent.currentArtifactHash !== agent.latestPublishedHash,
  );
  const unmappedRules = publishedRules.filter((rule) => !rule.controlMappings?.length);
  const mappedRules = publishedRules.length - unmappedRules.length;
  const findings: PostureFinding[] = [
    ...ungoverned
      .slice(0, 6)
      .map((agent) => ({
        id: `runtime-${agent.agentId}`,
        dimension: "SCOPE_INTEGRITY" as const,
        severity: "HIGH" as const,
        title: `Runtime ${agent.agentId} is not on the published artifact`,
        detail: "The declared runtime is drifted or has no policy provenance.",
        affectedScope: agent.runtimeAdapter ?? agent.runtimeStack,
        action: { label: "Inspect agent", href: `/${params.workspaceSlug}/agents` },
      })),
    ...drift
      .slice(0, 6)
      .map((rule) => ({
        id: `baseline-${rule.workspaceSlug}-${rule.stableRuleId}`,
        dimension: "CONTROL_HEALTH" as const,
        severity: "MEDIUM" as const,
        title: `${rule.stableRuleId} differs from the organization baseline`,
        detail: baselineById.has(rule.stableRuleId)
          ? "A workspace override needs an explicit review decision."
          : "This workspace-only rule has no organization baseline counterpart.",
        affectedScope: rule.workspaceName,
        action: { label: "Review policy", href: `/${params.workspaceSlug}/review` },
      })),
    ...(composition?.composition.conflictNotes.length
      ? composition.composition.conflictNotes
          .slice(0, 4)
          .map((note, index) => ({
            id: `composition-${index}`,
            dimension: "CONTROL_HEALTH" as const,
            severity: "MEDIUM" as const,
            title: "Policy composition requires review",
            detail: note,
            affectedScope: "Built policy bundle",
            action: { label: "Review composition", href: `/${params.workspaceSlug}/review` },
          }))
      : []),
    ...friction
      .slice(0, 4)
      .map((rule) => ({
        id: `friction-${rule.ruleId}`,
        dimension: "OPERATIONAL_EFFICIENCY" as const,
        severity: "MEDIUM" as const,
        title: `${rule.ruleId} is creating review friction`,
        detail: `${rule.denyCount} denials and ${rule.warnCount} warnings in recent evidence.`,
        affectedScope: "Runtime evidence",
        action: {
          label: "Inspect evidence",
          href: `/${params.workspaceSlug}/evidence?tab=friction`,
        },
      })),
    ...unused
      .slice(0, 4)
      .map((rule) => ({
        id: `unused-${rule.stableRuleId}`,
        dimension: "OPERATIONAL_EFFICIENCY" as const,
        severity: "LOW" as const,
        title: `${rule.stableRuleId} has no recent matches`,
        detail: "Confirm whether this is intentional coverage or obsolete policy.",
        affectedScope: rule.connectors.join(", ") || "All connectors",
        action: { label: "Inspect evidence", href: `/${params.workspaceSlug}/evidence?tab=unused` },
      })),
    ...(published && unmappedRules.length
      ? [
          {
            id: "control-mappings",
            dimension: "CONTROL_HEALTH" as const,
            severity: "LOW" as const,
            title: `${unmappedRules.length} published rules lack control mappings`,
            detail: "Map controls before relying on the export for external assurance.",
            affectedScope: "Published artifact",
            action: {
              label: "Open compliance packet",
              href: `/${params.workspaceSlug}/compliance#control-mappings`,
            },
          },
        ]
      : published
        ? [
            {
              id: "pack-maturity",
              dimension: "CONTROL_HEALTH" as const,
              severity: "LOW" as const,
              title: "Published pack controls are mapped",
              detail: `${mappedRules} published rule${mappedRules === 1 ? "" : "s"} carry at least one control mapping.`,
              affectedScope: "Published artifact",
              action: {
                label: "Open compliance packet",
                href: `/${params.workspaceSlug}/compliance#control-mappings`,
              },
            },
          ]
        : [
            {
              id: "pack-maturity",
              dimension: "CONTROL_HEALTH" as const,
              severity: "MEDIUM" as const,
              title: "No published pack is available for maturity assessment",
              detail:
                "Publish a reviewed artifact before evaluating its control mapping readiness.",
              affectedScope: "Workspace policy",
              action: { label: "Review policy", href: `/${params.workspaceSlug}/review` },
            },
          ]),
  ].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const status = findings.some((finding) => finding.severity === "HIGH")
    ? "AT_RISK"
    : findings.length
      ? "ATTENTION"
      : "READY";
  const dimension = (
    id: PostureDimension,
    label: string,
    matching: PostureFinding[],
    detail: string,
  ) => ({
    id,
    label,
    status: matching.some((finding) => finding.severity === "HIGH")
      ? ("AT_RISK" as const)
      : matching.length
        ? ("ATTENTION" as const)
        : ("READY" as const),
    detail,
  });
  return {
    status,
    summary: findings.length
      ? `${findings.length} prioritized finding${findings.length === 1 ? "" : "s"} need review.`
      : "Declared policy, runtimes, and evidence signals are aligned.",
    findings,
    dimensions: [
      dimension(
        "CONTROL_HEALTH",
        "Control health",
        findings.filter((finding) => finding.dimension === "CONTROL_HEALTH"),
        "Baseline alignment, composition, and pack/control maturity.",
      ),
      dimension(
        "SCOPE_INTEGRITY",
        "Scope integrity",
        findings.filter((finding) => finding.dimension === "SCOPE_INTEGRITY"),
        "Declared runtime inventory and provenance.",
      ),
      dimension(
        "OPERATIONAL_EFFICIENCY",
        "Operational efficiency",
        findings.filter((finding) => finding.dimension === "OPERATIONAL_EFFICIENCY"),
        "Evidence friction and unused policy.",
      ),
    ],
  };
}
