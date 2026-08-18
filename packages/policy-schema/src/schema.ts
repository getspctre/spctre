import yaml from "js-yaml";
import { createHash } from "node:crypto";
import { CANONICAL_PACK_CONNECTORS } from "./packs";
import {
  jsComposePolicyLayers,
  jsEvaluateGatewayDecision,
  jsEvaluatePolicyDecision,
} from "./native";
import {
  SEMANTIC_GENERIC_WORDS,
  SEMANTIC_MATCH_RATIO,
  SEMANTIC_STOP_WORDS,
  SEMANTIC_TOPICS,
} from "./semantic-topics";
import {
  PolicyArtifactExport,
  PolicyBranchTimeline,
  PolicyTimelineEvent,
  PublishReadiness,
  PublishBlocker,
  PolicyComplianceEvidenceExport,
  PublicationAttestationEvidence,
  GrcEvidenceBridgeDelivery,
  RuntimeDecisionEvidenceRecord,
  EvidenceRetentionPlan,
  EvidenceRetentionRule,
  PolicyCompositionPreview,
  PolicyRuleSummary,
  PolicyRevisionDiff,
  AgtCompatiblePolicyBundle,
  PolicyRuleDiff,
  PolicyApproval,
  SimulationRun,
  AgtRuntimeDecisionInput,
  RuntimeEvidenceSearchQuery,
  PolicyImportResult,
  PolicyRuleDiagnostic,
  PolicyReviewTask,
  RetentionDecision,
  SimulationReplayInput,
  SimulationRegressionSummary,
  CompositionLayer,
  RuntimeEvidenceSearchResult,
  PolicyApprovalRule,
  RuntimeDecisionStatus,
  EvaluationTraceStep,
  EvaluationResult,
  AdapterCapabilityDeclaration,
  BundleCompatibilityReport,
  BundleCompatibilityGap,
  GatewayDecisionInput,
  GatewayDecisionResult,
  AgtCompatibilityReport,
  AgtVerificationEvidencePacket,
  ComplianceFramework,
  ComplianceFrameworkAnnotation,
  ComplianceControl,
  SemanticCheck,
  PolicyControlMapping,
  PolicyDynamicCondition,
  PolicyParameterConstraint,
  PolicyBundleExportFormat,
  PolicyBundleExportManifest,
  PolicyBundleExportResult,
  PolicyBundleExportVerification,
  PolicySourceDialect,
  PolicySourceTranslationMapping,
  PolicySourceTranslationReport,
  AgentBlueprintRevision,
  AgentBlueprintRuntimeArtifact,
  AgentBlueprintRevisionDiff,
  AgentSurfaceBinding,
  CrossSurfaceIdentityEvent,
  CrossSurfaceIdentityHistory,
} from "./types";

export function buildPolicyBranchTimeline(params: {
  branchId: string;
  revisionId: string;
  events: PolicyTimelineEvent[];
}): PolicyBranchTimeline {
  const events = [...params.events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return {
    ...params,
    events,
    firstEventAt: events[0]?.createdAt,
    latestEventAt: events[events.length - 1]?.createdAt,
  };
}

export function buildComplianceEvidenceExport(params: {
  id: string;
  artifact: PolicyArtifactExport;
  readiness: PublishReadiness;
  timeline: PolicyBranchTimeline;
  evidence: RuntimeDecisionEvidenceRecord[];
  simulationRun?: SimulationRun;
  generatedAt: string;
  retentionDays: number;
  publicationAttestations?: PublicationAttestationEvidence[];
}): PolicyComplianceEvidenceExport {
  const evidence = params.evidence;
  const timeline = params.timeline;

  const retentionUntil = new Date(params.generatedAt);
  retentionUntil.setDate(retentionUntil.getDate() + params.retentionDays);

  return {
    ...params,
    retentionUntil: retentionUntil.toISOString(),
    evidenceCount: evidence.length,
    approvalCount: params.readiness.approvals.length,
    policyRefCount: evidence.reduce((acc, r) => acc + r.policyRefs.length, 0),
    timelineEventCount: timeline.events.length,
    artifactHash: params.artifact.artifactHash,
    simulationEventCount: params.simulationRun?.sourceEventCount ?? 0,
    packageSections: Array.from(new Set(params.artifact.rules.flatMap((r) => r.domains))),
    deniedDecisionCount: evidence.filter((r) => r.status === "DENY").length,
    warnedDecisionCount: evidence.filter((r) => r.status === "WARN").length,
    controlMappings: buildRuleControlMappingIndex(params.artifact.rules),
    publicationAttestations: params.publicationAttestations ?? [],
    publicationAttestationCount: params.publicationAttestations?.length ?? 0,
  };
}

/** Portable hand-off envelope for external GRC/compliance evidence consumers. */
export function buildGrcEvidenceBridgeExport(
  packet: PolicyComplianceEvidenceExport,
): GrcEvidenceBridgeDelivery["payload"] {
  return {
    schemaVersion: "spctre.grc-evidence-bridge.v1",
    generatedAt: packet.generatedAt,
    provenance: {
      artifactHash: packet.artifactHash,
      branchId: packet.artifact.branchId,
      revisionId: packet.artifact.revisionId,
    },
    evidence: {
      packageId: packet.id,
      evidenceCount: packet.evidenceCount,
      deniedDecisionCount: packet.deniedDecisionCount,
      warnedDecisionCount: packet.warnedDecisionCount,
      controlMappings: packet.controlMappings ?? [],
    },
  };
}

/** Build the external-delivery contract without performing network delivery. */
export function buildGrcEvidenceBridgeDelivery(params: {
  packet: PolicyComplianceEvidenceExport;
  destination: GrcEvidenceBridgeDelivery["destination"];
}): GrcEvidenceBridgeDelivery {
  const payload = buildGrcEvidenceBridgeExport(params.packet);
  return {
    schemaVersion: "spctre.grc-evidence-delivery.v1",
    destination: params.destination,
    idempotencyKey: `spctre:${payload.provenance.artifactHash}:${payload.evidence.packageId}`,
    payload,
  };
}

export function buildEvidenceRetentionPlan(params: {
  id: string;
  evidence: RuntimeDecisionEvidenceRecord[];
  rules: EvidenceRetentionRule[];
  generatedAt: string;
  expiringWithinDays: number;
}): EvidenceRetentionPlan {
  const decisions: RetentionDecision[] = params.evidence.map((record) => {
    let bestRule: EvidenceRetentionRule | undefined;
    for (const rule of params.rules) {
      const statusMatch =
        !rule.appliesTo.statuses || rule.appliesTo.statuses.includes(record.status);
      const envMatch =
        !rule.appliesTo.environments || rule.appliesTo.environments.includes(record.environment);
      const stackMatch =
        !rule.appliesTo.runtimeStacks ||
        rule.appliesTo.runtimeStacks.includes(record.runtimeTarget.stack);

      if (statusMatch && envMatch && stackMatch) {
        if (!bestRule || rule.retentionDays > bestRule.retentionDays) {
          bestRule = rule;
        }
      }
    }

    const retentionDays = bestRule?.retentionDays ?? 0;
    const createdAt = new Date(record.createdAt);
    const retainUntil = new Date(createdAt);
    retainUntil.setDate(retainUntil.getDate() + retentionDays);

    const now = new Date(params.generatedAt);
    const diffMs = retainUntil.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let disposition: "ACTIVE" | "EXPIRING" | "EXPIRED" = "ACTIVE";
    if (daysRemaining <= 0) disposition = "EXPIRED";
    else if (daysRemaining <= params.expiringWithinDays) disposition = "EXPIRING";

    return {
      decisionId: record.decisionId,
      connector: record.connector,
      environment: record.environment,
      runtimeStack: record.runtimeTarget.stack,
      disposition,
      retentionLabel: bestRule?.label ?? "Default (0 days)",
      retainUntil: retainUntil.toISOString(),
      daysRemaining,
      exportable: !!bestRule?.exportable,
    };
  });

  return {
    ...params,
    activeCount: decisions.filter((d) => d.disposition === "ACTIVE").length,
    expiringCount: decisions.filter((d) => d.disposition === "EXPIRING").length,
    expiredCount: decisions.filter((d) => d.disposition === "EXPIRED").length,
    exportableCount: decisions.filter((d) => d.exportable).length,
    longestRetentionDays:
      params.rules.length > 0 ? Math.max(...params.rules.map((r) => r.retentionDays)) : 0,
    decisions,
  };
}

export function buildPolicyArtifactExport(params: {
  bundle: AgtCompatiblePolicyBundle;
  artifactHash?: string;
  generatedAt: string;
}): PolicyArtifactExport {
  const { bundle } = params;
  return {
    branchId: bundle.branchId,
    revisionId: bundle.revisionId,
    artifactHash: params.artifactHash || bundle.artifactHash,
    sourceHash: bundle.sourceHash,
    sourceFormat: bundle.sourceFormat,
    targetStacks: bundle.targetStacks,
    rules: bundle.rules,
    generatedAt: params.generatedAt,
  };
}

/** The import envelope parsed from a declarative Blueprint source document. */
export interface AgentBlueprintSourceEnvelope {
  name: string;
  agentId: string;
  message: string;
  /** Raw, unvalidated — the control plane validates via parseAgentBlueprintDefinition. */
  definition: Record<string, unknown>;
}

/**
 * Parses a declarative Blueprint source (YAML or JSON) into its import envelope.
 *
 * The source names the governing policy branch via `definition.policyBranchId`
 * (a branch NAME) and must NOT pin `definition.policyRevisionId` — the import
 * resolves the branch's currently-published revision server-side. The returned
 * `definition` is raw; the control plane validates it with
 * parseAgentBlueprintDefinition before persisting a draft.
 */
export function parseAgentBlueprintSource(params: {
  document: string;
  sourcePath?: string;
}): { envelope: AgentBlueprintSourceEnvelope } | { error: string } {
  const content = params.document.trim();
  if (!content) return { error: "Blueprint source is required." };

  let parsed: unknown;
  try {
    const isJson = content.startsWith("{") || content.startsWith("[");
    parsed = isJson ? JSON.parse(content) : yaml.load(content);
  } catch (e) {
    return { error: `Failed to parse Blueprint source: ${String(e)}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Blueprint source must be an object with name, agentId, and definition." };
  }

  const doc = parsed as Record<string, unknown>;
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  const agentId = typeof doc.agentId === "string" ? doc.agentId.trim() : "";
  const message =
    typeof doc.message === "string" && doc.message.trim()
      ? doc.message.trim()
      : "Imported Blueprint revision";
  if (!name) return { error: "Blueprint source is missing 'name'." };
  if (!agentId) return { error: "Blueprint source is missing 'agentId'." };
  if (!doc.definition || typeof doc.definition !== "object" || Array.isArray(doc.definition)) {
    return { error: "Blueprint source is missing a 'definition' object." };
  }

  const definition = doc.definition as Record<string, unknown>;
  if (definition.policyRevisionId !== undefined) {
    return {
      error:
        "Blueprint source must not set definition.policyRevisionId; the import resolves the published revision.",
    };
  }

  return { envelope: { name, agentId, message, definition } };
}

export function buildAgentBlueprintRuntimeArtifact(params: {
  revision: AgentBlueprintRevision;
  name: string;
  policyArtifactHash?: string;
  generatedAt: string;
}): AgentBlueprintRuntimeArtifact {
  const { definition } = params.revision;
  return {
    kind: "spctre.agent-blueprint.v1",
    blueprint: {
      blueprintId: params.revision.blueprintId,
      revisionId: params.revision.id,
      definitionHash: params.revision.definitionHash,
      name: params.name,
    },
    purpose: definition.purpose,
    allowedTaskClasses: definition.allowedTaskClasses,
    tools: definition.tools,
    connectors: definition.connectors,
    services: definition.services,
    environments: definition.environments,
    runtimeTargets: definition.runtimeTargets,
    budgets: definition.budgets,
    approvalPath: definition.approvalPath,
    policy:
      definition.policyBranchId || definition.policyRevisionId || params.policyArtifactHash
        ? {
            branchId: definition.policyBranchId,
            revisionId: definition.policyRevisionId,
            artifactHash: params.policyArtifactHash,
          }
        : undefined,
    generatedAt: params.generatedAt,
  };
}

export function diffAgentBlueprintRevisions(params: {
  base: AgentBlueprintRevision;
  compare: AgentBlueprintRevision;
}): AgentBlueprintRevisionDiff {
  const fields: Array<keyof AgentBlueprintRevision["definition"]> = [
    "purpose",
    "allowedTaskClasses",
    "tools",
    "connectors",
    "services",
    "environments",
    "runtimeTargets",
    "budgets",
    "approvalPath",
    "policyBranchId",
    "policyRevisionId",
  ];
  const changedFields = fields.filter(
    (field) =>
      JSON.stringify(sortJsonValue(params.base.definition[field])) !==
      JSON.stringify(sortJsonValue(params.compare.definition[field])),
  );
  return {
    blueprintId: params.compare.blueprintId,
    baseRevisionId: params.base.id,
    compareRevisionId: params.compare.id,
    changedFields,
    summary:
      changedFields.length === 0
        ? "No declared operating-envelope fields changed."
        : `${changedFields.length} declared operating-envelope field${changedFields.length === 1 ? "" : "s"} changed.`,
  };
}

/**
 * Merge per-source cross-surface events into one canonical-agent timeline.
 *
 * The control plane already persists decisions, trust scores, identity
 * lifecycle events, and reviewer resolutions against runtime-local agent
 * identities. This joins them by canonical identity, sorts newest-first, caps
 * the result, and derives the per-kind counts and latest trust score that the
 * reviewer/evidence views render. It is intentionally pure so the aggregation
 * is testable without a database.
 */
export function buildCrossSurfaceIdentityHistory(params: {
  canonicalAgentId: string;
  surfaces: AgentSurfaceBinding[];
  events: CrossSurfaceIdentityEvent[];
  limit?: number;
  generatedAt?: string;
}): CrossSurfaceIdentityHistory {
  const sorted = [...params.events].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const limited =
    typeof params.limit === "number" ? sorted.slice(0, Math.max(0, params.limit)) : sorted;
  const counts = { decisions: 0, trust: 0, identity: 0, reviews: 0 };
  for (const event of limited) {
    if (event.kind === "DECISION") counts.decisions += 1;
    else if (event.kind === "TRUST") counts.trust += 1;
    else if (event.kind === "IDENTITY") counts.identity += 1;
    else if (event.kind === "REVIEW") counts.reviews += 1;
  }
  const latestTrust = limited.find((event) => event.kind === "TRUST");
  const latestTrustScore =
    latestTrust && typeof latestTrust.detail?.trustScore === "number"
      ? (latestTrust.detail.trustScore as number)
      : undefined;
  return {
    canonicalAgentId: params.canonicalAgentId,
    surfaces: params.surfaces,
    surfaceCount: params.surfaces.length,
    events: limited,
    counts,
    latestTrustScore,
    generatedAt: params.generatedAt,
  };
}

type ExportArtifact = string | Record<string, unknown>;

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJsonValue(child)]),
  );
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exportTarget(format: PolicyBundleExportFormat): string {
  switch (format) {
    case "spctre-json":
      return "AGT-compatible JSON bundle";
    case "opa-rego":
      return "Open Policy Agent Rego policy";
    case "opa-bundle":
      return "Open Policy Agent data bundle";
    case "cedar":
      return "AWS Cedar policy";
    case "mcp-proxy-config":
      return "MCP proxy configuration";
  }
}

function verificationTargetsForExport(format: PolicyBundleExportFormat): string[] {
  switch (format) {
    case "spctre-json":
      return ["spctre bundle verify", "agt verify --evidence"];
    case "opa-rego":
      return ["opa fmt", "opa check", "opa test"];
    case "opa-bundle":
      return ["opa build", "opa check", "opa test"];
    case "cedar":
      return ["cedar validate", "cedar authorize"];
    case "mcp-proxy-config":
      return ["spctre mcp config validate"];
  }
}

function contentTypeForExport(format: PolicyBundleExportFormat): string {
  switch (format) {
    case "opa-rego":
      return "text/x-rego";
    case "cedar":
      return "text/plain";
    default:
      return "application/json";
  }
}

function fileNameForExport(
  bundle: AgtCompatiblePolicyBundle,
  format: PolicyBundleExportFormat,
): string {
  const prefix = `${bundle.branchId}-${bundle.revisionId}`;
  switch (format) {
    case "spctre-json":
      return `${prefix}.spctre.bundle.json`;
    case "opa-rego":
      return `${prefix}.rego`;
    case "opa-bundle":
      return `${prefix}.opa-bundle.json`;
    case "cedar":
      return `${prefix}.cedar`;
    case "mcp-proxy-config":
      return `${prefix}.mcp-proxy.json`;
  }
}

function hasSecretMaterial(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => hasSecretMaterial(child, `${path}[${index}]`));
  }
  const secretKeyPattern = /(api[_-]?key|credential|password|private[_-]?key|secret|token)/i;
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const current = secretKeyPattern.test(key) ? [childPath] : [];
    return [...current, ...hasSecretMaterial(child, childPath)];
  });
}

function blockingDynamicConditionWarnings(
  bundle: AgtCompatiblePolicyBundle,
  format: PolicyBundleExportFormat,
  supportedKinds: Set<string>,
): string[] {
  if (format === "spctre-json") return [];
  const blockingEffects = new Set(["DENY", "ESCALATE"]);
  return bundle.rules.flatMap((rule) => {
    if (!blockingEffects.has(rule.effect)) return [];
    return (rule.dynamicConditions ?? [])
      .filter((condition) => !supportedKinds.has(condition.kind))
      .map(
        (condition) =>
          `${format} cannot enforce ${condition.kind} for blocking rule ${rule.stableRuleId}.`,
      );
  });
}

function baseSemanticWarnings(
  bundle: AgtCompatiblePolicyBundle,
  format: PolicyBundleExportFormat,
): string[] {
  const warnings = [...(bundle.compatibility?.semanticWarnings ?? [])];
  if (format === "cedar" && bundle.rules.some((rule) => rule.effect === "WARN")) {
    warnings.push(
      "Cedar has no native WARN effect; WARN rules are exported as advisory comments only.",
    );
  }
  if (format === "mcp-proxy-config" && bundle.rules.some((rule) => rule.semanticChecks?.length)) {
    warnings.push(
      "MCP proxy configuration cannot execute semantic prompt checks without a runtime evaluator.",
    );
  }
  return Array.from(new Set(warnings));
}

function baseBlockingWarnings(
  bundle: AgtCompatiblePolicyBundle,
  format: PolicyBundleExportFormat,
): string[] {
  const secretPaths = [
    ...hasSecretMaterial(bundle.metadata, "metadata"),
    ...hasSecretMaterial(bundle.sourceDocument, "sourceDocument"),
    ...bundle.rules.flatMap((rule, index) => hasSecretMaterial(rule, `rules[${index}]`)),
  ];
  const secretWarnings = secretPaths.map(
    (path) => `Export input contains secret-like field ${path}.`,
  );
  const dynamicWarnings = blockingDynamicConditionWarnings(
    bundle,
    format,
    format === "opa-rego" || format === "opa-bundle"
      ? new Set([
          "TIME_WINDOW",
          "DAILY_SPEND_LIMIT",
          "PER_CALL_COST_LIMIT",
          "SESSION_CUMULATIVE_COST_LIMIT",
          "BUDGET_UTILIZATION_THRESHOLD",
        ])
      : new Set(),
  );
  const cedarWarnings =
    format === "cedar"
      ? bundle.rules
          .filter((rule) => rule.effect === "ESCALATE")
          .map((rule) => `Cedar cannot enforce ESCALATE semantics for rule ${rule.stableRuleId}.`)
      : [];
  return Array.from(new Set([...secretWarnings, ...dynamicWarnings, ...cedarWarnings]));
}

function buildManifest(params: {
  bundle: AgtCompatiblePolicyBundle;
  format: PolicyBundleExportFormat;
  generatedAt: string;
  compiledArtifactHash: string;
  semanticWarnings: string[];
  blockingWarnings: string[];
}): PolicyBundleExportManifest {
  const { bundle, format } = params;
  return {
    format,
    target: exportTarget(format),
    compatibilityLevel: bundle.compatibility?.compatibilityLevel ?? "NATIVE",
    semanticWarnings: params.semanticWarnings,
    blockingWarnings: params.blockingWarnings,
    verificationTargets: verificationTargetsForExport(format),
    artifactHash: bundle.artifactHash,
    compiledArtifactHash: params.compiledArtifactHash,
    generatedAt: params.generatedAt,
    provenance: {
      tenantId: bundle.tenantId,
      workspaceId: bundle.workspaceId,
      branchId: bundle.branchId,
      revisionId: bundle.revisionId,
      sourceHash: bundle.sourceHash,
      sourceFormat: bundle.sourceFormat,
      sourcePath: bundle.sourcePath,
      targetStacks: bundle.targetStacks,
    },
    ruleCount: bundle.rules.length,
  };
}

function buildSpctreJsonArtifact(bundle: AgtCompatiblePolicyBundle): Record<string, unknown> {
  return {
    schemaVersion: "spctre.bundle.export.v1",
    bundle,
    provenance: {
      tenantId: bundle.tenantId,
      workspaceId: bundle.workspaceId,
      branchId: bundle.branchId,
      revisionId: bundle.revisionId,
      artifactHash: bundle.artifactHash,
    },
  };
}

function buildOpaRego(bundle: AgtCompatiblePolicyBundle): string {
  return [
    "package spctre.policy",
    "",
    `# branch_id: ${bundle.branchId}`,
    `# revision_id: ${bundle.revisionId}`,
    `# artifact_hash: ${bundle.artifactHash}`,
    "",
    'default decision := {"effect": "ALLOW", "matched_policy_refs": [], "reason": "No Spctre rule matched."}',
    "",
    "decision := result if {",
    "  some rule in data.spctre.rules",
    "  input.connector == rule.connector",
    "  input.action == rule.action",
    "  spctre_conditions_ok(rule)",
    "  result := {",
    '    "effect": rule.effect,',
    '    "matched_policy_refs": [rule.stable_rule_id],',
    '    "reason": sprintf("Matched Spctre rule %s", [rule.stable_rule_id]),',
    '    "branch_id": data.spctre.provenance.branch_id,',
    '    "revision_id": data.spctre.provenance.revision_id,',
    '    "artifact_hash": data.spctre.provenance.artifact_hash,',
    "  }",
    "}",
    "",
    "spctre_conditions_ok(rule) if { count(rule.dynamic_conditions) == 0 }",
    "spctre_conditions_ok(rule) if {",
    "  count(rule.dynamic_conditions) > 0",
    "  every cond in rule.dynamic_conditions { spctre_condition_ok(cond) }",
    "}",
    "",
    "spctre_condition_ok(cond) if {",
    '  cond.kind == "TIME_WINDOW"',
    "  input.context.hour_of_day >= cond.window.start_hour",
    "  input.context.hour_of_day <= cond.window.end_hour",
    "}",
    "spctre_condition_ok(cond) if {",
    '  cond.kind == "DAILY_SPEND_LIMIT"',
    "  input.context.daily_spend_usd <= cond.value",
    "}",
    "spctre_condition_ok(cond) if {",
    '  cond.kind == "PER_CALL_COST_LIMIT"',
    "  input.context.call_cost_usd <= cond.value",
    "}",
    "spctre_condition_ok(cond) if {",
    '  cond.kind == "SESSION_CUMULATIVE_COST_LIMIT"',
    "  input.context.session_cumulative_cost_usd <= cond.value",
    "}",
    "spctre_condition_ok(cond) if {",
    '  cond.kind == "BUDGET_UTILIZATION_THRESHOLD"',
    "  input.context.budget_utilization_pct <= cond.value",
    "}",
    "",
  ].join("\n");
}

function buildOpaData(
  bundle: AgtCompatiblePolicyBundle,
  generatedAt: string,
): Record<string, unknown> {
  return {
    spctre: {
      provenance: {
        tenant_id: bundle.tenantId,
        workspace_id: bundle.workspaceId,
        branch_id: bundle.branchId,
        revision_id: bundle.revisionId,
        artifact_hash: bundle.artifactHash,
        generated_at: generatedAt,
      },
      rules: bundle.rules.flatMap((rule) => {
        const connectors = rule.connectors.length ? rule.connectors : ["*"];
        const actions = rule.actions.length ? rule.actions : ["*"];
        return connectors.flatMap((connector) =>
          actions.map((action) => ({
            stable_rule_id: rule.stableRuleId,
            title: rule.title,
            effect: rule.effect,
            connector,
            action,
            conditions: rule.conditions ?? [],
            dynamic_conditions: rule.dynamicConditions ?? [],
          })),
        );
      }),
    },
  };
}

function cedarIdent(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function buildCedarPolicy(bundle: AgtCompatiblePolicyBundle): string {
  const lines = [
    `// branch_id: ${bundle.branchId}`,
    `// revision_id: ${bundle.revisionId}`,
    `// artifact_hash: ${bundle.artifactHash}`,
    "//",
    "// Entity mapping:",
    "//   Principal namespace: Agent",
    '//   Action namespace:    Action::"<connector>.<action>"',
    '//   Resource namespace:  Connector::"<connector>"',
    "//   Provision these entity types in your Cedar schema before deploying.",
    "",
  ];
  for (const rule of bundle.rules) {
    if (rule.effect === "WARN") {
      lines.push(
        `// Rule: ${rule.title} [${rule.stableRuleId}] (WARN — advisory, not enforced by Cedar)`,
      );
      lines.push("");
      continue;
    }
    if (rule.effect === "ESCALATE") {
      lines.push(
        `// ${rule.effect} rule ${rule.stableRuleId} is advisory/blocking in manifest warnings.`,
      );
      lines.push("");
      continue;
    }
    const connectors = rule.connectors.length ? rule.connectors : ["*"];
    const actions = rule.actions.length ? rule.actions : ["*"];
    const actionEntries = connectors.flatMap((connector) =>
      actions.map((action) => `Action::"${connector}.${cedarIdent(action)}"`),
    );
    const resourceEntries = Array.from(new Set(connectors)).map(
      (connector) => `Connector::"${connector}"`,
    );
    const cedarEffect = rule.effect === "DENY" ? "forbid" : "permit";
    lines.push(`// Rule: ${rule.title} [${rule.stableRuleId}]`);
    lines.push(`${cedarEffect}(`);
    lines.push("  principal,");
    lines.push(`  action in [${actionEntries.join(", ")}],`);
    lines.push(`  resource in [${resourceEntries.join(", ")}]`);
    lines.push(`) when { context.artifact_hash == "${bundle.artifactHash}" };`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildMcpProxyConfig(
  bundle: AgtCompatiblePolicyBundle,
  generatedAt: string,
): Record<string, unknown> {
  return {
    schemaVersion: "spctre.mcp.proxy.config.v1",
    generatedAt,
    provenance: {
      tenantId: bundle.tenantId,
      workspaceId: bundle.workspaceId,
      branchId: bundle.branchId,
      revisionId: bundle.revisionId,
      artifactHash: bundle.artifactHash,
    },
    rules: bundle.rules.map((rule) => ({
      id: rule.stableRuleId,
      title: rule.title,
      effect: rule.effect,
      connectors: rule.connectors,
      actions: rule.actions,
      parameterSchemas:
        rule.preservedFields?.parameterSchemas ?? rule.preservedFields?.parameters ?? null,
      parameterConstraints: rule.parameterConstraints ?? [],
      rawConditions: rule.conditions ?? [],
      advisoryDynamicConditions: (rule.dynamicConditions ?? []).filter(
        (c) => rule.effect === "ALLOW" || rule.effect === "WARN",
      ),
      policyRefs: [rule.stableRuleId],
    })),
  };
}

function artifactForFormat(
  bundle: AgtCompatiblePolicyBundle,
  format: PolicyBundleExportFormat,
  generatedAt: string,
): ExportArtifact {
  switch (format) {
    case "spctre-json":
      return buildSpctreJsonArtifact(bundle);
    case "opa-rego":
      return buildOpaRego(bundle);
    case "opa-bundle":
      return {
        "data.json": buildOpaData(bundle, generatedAt),
        "policy.rego": buildOpaRego(bundle),
      };
    case "cedar":
      return buildCedarPolicy(bundle);
    case "mcp-proxy-config":
      return buildMcpProxyConfig(bundle, generatedAt);
  }
}

export function buildPolicyBundleExport(params: {
  bundle: AgtCompatiblePolicyBundle;
  format: PolicyBundleExportFormat;
  generatedAt?: string;
}): PolicyBundleExportResult {
  const generatedAt = params.generatedAt ?? params.bundle.generatedAt;
  const semanticWarnings = baseSemanticWarnings(params.bundle, params.format);
  const blockingWarnings = baseBlockingWarnings(params.bundle, params.format);
  const artifact = artifactForFormat(params.bundle, params.format, generatedAt);
  const compiledArtifactHash = sha256(
    typeof artifact === "string" ? artifact : stableJson(artifact),
  );
  const manifest = buildManifest({
    bundle: params.bundle,
    format: params.format,
    generatedAt,
    compiledArtifactHash,
    semanticWarnings,
    blockingWarnings,
  });

  return {
    ok: blockingWarnings.length === 0,
    format: params.format,
    contentType: contentTypeForExport(params.format),
    fileName: fileNameForExport(params.bundle, params.format),
    artifact: blockingWarnings.length === 0 ? artifact : null,
    manifest,
  };
}

export function buildPolicyBundleExports(params: {
  bundle: AgtCompatiblePolicyBundle;
  formats: PolicyBundleExportFormat[];
  generatedAt?: string;
}): PolicyBundleExportResult[] {
  return params.formats.map((format) =>
    buildPolicyBundleExport({ bundle: params.bundle, format, generatedAt: params.generatedAt }),
  );
}

/**
 * Compile a reviewed bundle into a small, dependency-free configuration shape
 * for a Mastra tool middleware. The runtime still emits decisions back to
 * Spctre; this is an adapter, not a second policy source of truth.
 */
export function buildTypeScriptRuntimePolicyConfig(
  bundle: AgtCompatiblePolicyBundle,
  target: "mastra" | "vercel-ai" | "genkit" | "governance-sdk",
) {
  const blocked = baseBlockingWarnings(bundle, "spctre-json");
  const artifact = {
    schemaVersion: `spctre.${target}-policy.v1`,
    provenance: {
      branchId: bundle.branchId,
      revisionId: bundle.revisionId,
      artifactHash: bundle.artifactHash,
      sourceHash: bundle.sourceHash,
    },
    rules: bundle.rules.map((rule) => ({
      id: rule.stableRuleId,
      effect: rule.effect,
      connectors: rule.connectors,
      actions: rule.actions,
      semanticChecks: rule.semanticChecks ?? [],
    })),
  };
  return {
    ok: blocked.length === 0,
    artifact: blocked.length === 0 ? artifact : null,
    blockingWarnings: blocked,
    compiledArtifactHash: sha256(stableJson(artifact)),
  };
}

export function buildMastraRuntimePolicyConfig(bundle: AgtCompatiblePolicyBundle) {
  return buildTypeScriptRuntimePolicyConfig(bundle, "mastra");
}

export function buildVercelAiRuntimePolicyConfig(bundle: AgtCompatiblePolicyBundle) {
  return buildTypeScriptRuntimePolicyConfig(bundle, "vercel-ai");
}

export function buildGenkitRuntimePolicyConfig(bundle: AgtCompatiblePolicyBundle) {
  return buildTypeScriptRuntimePolicyConfig(bundle, "genkit");
}

export function buildGovernanceSdkRuntimePolicyConfig(bundle: AgtCompatiblePolicyBundle) {
  return buildTypeScriptRuntimePolicyConfig(bundle, "governance-sdk");
}

export function verifyPolicyBundleExport(params: {
  artifact: ExportArtifact | null;
  manifest: PolicyBundleExportManifest;
}): PolicyBundleExportVerification {
  const issues: string[] = [];
  if (params.manifest.blockingWarnings.length > 0) {
    issues.push("Export manifest contains blocking warnings.");
  }
  if (!params.artifact) {
    issues.push("Export artifact is missing.");
  }

  const actualHash = params.artifact
    ? sha256(typeof params.artifact === "string" ? params.artifact : stableJson(params.artifact))
    : null;

  if (actualHash && actualHash !== params.manifest.compiledArtifactHash) {
    issues.push("Compiled artifact hash does not match manifest.");
  }
  if (!params.manifest.provenance.branchId || !params.manifest.provenance.revisionId) {
    issues.push("Manifest provenance is missing branch or revision identity.");
  }
  if (!params.manifest.provenance.sourceHash || !params.manifest.artifactHash) {
    issues.push("Manifest provenance is missing source or artifact hash.");
  }
  if (params.manifest.ruleCount < 0) {
    issues.push("Manifest rule count is invalid.");
  }
  if (params.manifest.verificationTargets.length === 0) {
    issues.push("Manifest does not declare verification targets.");
  }

  return {
    ok: issues.length === 0,
    expectedHash: params.manifest.compiledArtifactHash,
    actualHash,
    issues,
  };
}

export function buildAgtVerificationEvidencePacket(params: {
  bundle: AgtCompatiblePolicyBundle;
  evidence: RuntimeDecisionEvidenceRecord[];
  generatedAt: string;
  escalations?: Array<{
    id: string;
    decisionId: string;
    revisionId?: string;
    artifactHash: string;
    resolutionOutcome: "PROCEED" | "ESCALATE" | "ABORT";
    resolutionNote?: string;
    resolvedAt: string;
  }>;
  verificationResults?: import("./types").AgtVerificationResult[];
}): AgtVerificationEvidencePacket {
  const artifact = buildPolicyArtifactExport({
    bundle: params.bundle,
    artifactHash: params.bundle.artifactHash,
    generatedAt: params.generatedAt,
  });

  const escalations = params.escalations ?? [];

  return {
    schemaVersion: "spctre.agt.evidence.v1",
    generatedAt: params.generatedAt,
    verifier: { command: "agt verify --evidence", strictCommand: "agt verify --evidence --strict" },
    artifact,
    bundle: params.bundle,
    evidence: params.evidence,
    verificationResults: params.verificationResults,
    escalations,
    provenance: {
      tenantId: params.bundle.tenantId,
      workspaceId: params.bundle.workspaceId,
      branchId: params.bundle.branchId,
      revisionId: params.bundle.revisionId,
      artifactHash: params.bundle.artifactHash,
      approvalCount: params.bundle.approvals.length,
      evidenceCount: params.evidence.length,
      policyRefCount: params.evidence.reduce((acc, record) => acc + record.policyRefs.length, 0),
      escalationCount: escalations.length,
    },
  };
}

export function buildAgtRuntimeEvidenceV1(params: {
  generatedAt: string;
  toolkitVersion: string;
  /** Relative filename materialized by the verification worker, never a runtime path. */
  materializedPolicyFilename: string;
  policyContentHash: string;
  registeredTools: string[];
  auditSinkTarget: string;
  agentId: string;
  packages: Array<{ package: string; version: string }>;
}): import("./types").AgtRuntimeEvidenceV1 {
  if (!/^[A-Za-z0-9._-]+$/.test(params.materializedPolicyFilename)) {
    throw new Error("AGT policy filename must be a single relative filename.");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(params.policyContentHash)) {
    throw new Error("AGT policy content hash must be a lowercase SHA-256 digest.");
  }
  return {
    schema: "agt-runtime-evidence/v1",
    generated_at: params.generatedAt,
    toolkit_version: params.toolkitVersion,
    deployment: {
      policy_files_loaded: [params.materializedPolicyFilename],
      registered_tools: params.registeredTools,
      audit_sink: { enabled: true, target: params.auditSinkTarget },
      identity: { enabled: true, agent_id: params.agentId },
      packages: params.packages,
    },
    spctre: { policy_content_hash: params.policyContentHash },
  };
}

export function buildSimulationRun(params: {
  id: string;
  branchId: string;
  revisionId: string;
  sourceEventCount: number;
  createdBy: string;
  createdAt: string;
  results: SimulationReplayInput[];
  regressionSummary?: SimulationRegressionSummary;
}): SimulationRun {
  const results = params.results;
  const newlyDeniedCount = results.filter(
    (r) => r.previousStatus !== "DENY" && r.proposedStatus === "DENY",
  ).length;
  const newlyAllowedCount = results.filter(
    (r) => r.previousStatus === "DENY" && r.proposedStatus === "ALLOW",
  ).length;
  const unchangedCount = results.filter((r) => r.previousStatus === r.proposedStatus).length;

  return { ...params, newlyDeniedCount, newlyAllowedCount, unchangedCount };
}

export function buildSimulationRegressionSummary(params: {
  results: SimulationReplayInput[];
  highRiskEventIds?: Iterable<string>;
  coverage: SimulationRegressionSummary["coverage"];
}): SimulationRegressionSummary {
  const highRiskEventIds = new Set(params.highRiskEventIds);
  const newlyDeniedExpectedWorkCount = params.results.filter(
    (result) => result.previousStatus !== "DENY" && result.proposedStatus === "DENY",
  ).length;
  const removedEscalationCoverageCount = params.results.filter(
    (result) => result.previousStatus === "ESCALATE" && result.proposedStatus !== "ESCALATE",
  ).length;
  const newlyAllowedHighRiskCount = params.results.filter(
    (result) =>
      highRiskEventIds.has(result.eventId) &&
      result.previousStatus === "DENY" &&
      result.proposedStatus !== "DENY",
  ).length;
  return {
    coverage: params.coverage,
    newlyDeniedExpectedWorkCount,
    removedEscalationCoverageCount,
    newlyAllowedHighRiskCount,
    blockingCount:
      newlyDeniedExpectedWorkCount + removedEscalationCoverageCount + newlyAllowedHighRiskCount,
  };
}

export function composePolicyLayers(params: {
  id: string;
  branchId: string;
  revisionId: string;
  layers: CompositionLayer[];
  composedArtifactHash: string;
  composedAt: string;
}): PolicyCompositionPreview {
  // Composition semantics — layer precedence, immutable-rule protection and the
  // conflict notes — belong to the kernel, which is the single implementation
  // enforcement uses. The kernel returns winning positions rather than rules, so
  // the effective rules below are this host's own objects: any field the kernel
  // does not model (control mappings, authoring metadata) survives composition.
  const selection = JSON.parse(
    jsComposePolicyLayers(
      JSON.stringify({
        layers: params.layers.map((layer) => ({
          scope: layer.scope,
          rules: layer.rules.map((rule) => ({
            stableRuleId: rule.stableRuleId,
            immutable: rule.immutable,
          })),
        })),
      }),
    ),
  ) as { effective: { layerIndex: number; ruleIndex: number }[]; conflictNotes: string[] };

  const effectiveRules = selection.effective.map(
    (slot) => params.layers[slot.layerIndex].rules[slot.ruleIndex],
  );
  return { ...params, effectiveRules, conflictNotes: selection.conflictNotes };
}

export function diffPolicyRules(params: {
  branchId: string;
  baseRevisionId: string;
  compareRevisionId: string;
  before: PolicyRuleSummary[];
  after: PolicyRuleSummary[];
}): PolicyRevisionDiff {
  const beforeMap = new Map(params.before.map((r) => [r.stableRuleId, r]));
  const afterMap = new Map(params.after.map((r) => [r.stableRuleId, r]));
  const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const rules: PolicyRuleDiff[] = [];
  let added = 0;
  let modified = 0;
  let removed = 0;
  let unchanged = 0;

  for (const id of allIds) {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);

    if (before && !after) {
      rules.push({ stableRuleId: id, status: "REMOVED", before });
      removed++;
    } else if (!before && after) {
      rules.push({ stableRuleId: id, status: "ADDED", after });
      added++;
    } else if (before && after) {
      const changedFields: string[] = [];
      if (before.title !== after.title) changedFields.push("title");
      if (before.effect !== after.effect) changedFields.push("effect");
      if (before.immutable !== after.immutable) changedFields.push("immutable");
      if (JSON.stringify(before.actions) !== JSON.stringify(after.actions))
        changedFields.push("actions");
      if (JSON.stringify(before.connectors) !== JSON.stringify(after.connectors))
        changedFields.push("connectors");
      if (JSON.stringify(before.domains) !== JSON.stringify(after.domains))
        changedFields.push("domains");
      if (JSON.stringify(before.conditions) !== JSON.stringify(after.conditions))
        changedFields.push("conditions");
      if (JSON.stringify(before.semanticChecks) !== JSON.stringify(after.semanticChecks))
        changedFields.push("semanticChecks");
      if (JSON.stringify(before.controlMappings) !== JSON.stringify(after.controlMappings))
        changedFields.push("controlMappings");
      // parameterConstraints carry the typed thresholds a pack override rewrites
      // (e.g. a refund review limit). Omitting them meant a pack upgrade — or an
      // authored change — that only moved a threshold rendered as UNCHANGED: a
      // silent replace, the opposite of the reviewable-diff contract. Detect them
      // so a threshold change surfaces in the same operational diff as any other.
      if (
        JSON.stringify(before.parameterConstraints) !== JSON.stringify(after.parameterConstraints)
      )
        changedFields.push("parameterConstraints");

      if (changedFields.length > 0) {
        rules.push({ stableRuleId: id, status: "MODIFIED", before, after, changedFields });
        modified++;
      } else {
        rules.push({ stableRuleId: id, status: "UNCHANGED", before, after });
        unchanged++;
      }
    }
  }

  return { ...params, rules, summary: { added, modified, removed, unchanged } };
}

/** Groups rule-level control mappings for review and evidence export surfaces. */
export function buildRuleControlMappingIndex(rules: PolicyRuleSummary[]) {
  const mappings = rules.flatMap((rule) =>
    (rule.controlMappings ?? []).map((mapping) => ({
      stableRuleId: rule.stableRuleId,
      effect: rule.effect,
      ...mapping,
    })),
  );
  const seen = new Set<string>();
  return mappings
    .sort((a, b) =>
      `${a.framework}:${a.controlId}:${a.stableRuleId}`.localeCompare(
        `${b.framework}:${b.controlId}:${b.stableRuleId}`,
      ),
    )
    .filter((mapping) => {
      const key = `${mapping.stableRuleId}:${mapping.framework}:${mapping.controlId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface ControlEvidenceRollupEntry {
  framework: PolicyControlMapping["framework"];
  controlId: string;
  rationale?: string;
  stableRuleIds: string[];
  decisionCount: number;
  deniedCount: number;
  warnedCount: number;
  latestEvidenceAt?: string;
}

/**
 * Joins the rule-to-control mapping index against evidence records
 * (matched by policyRefs) to produce a per-control proof rollup: how many
 * runtime decisions actually exercised each control, and when most recently.
 * Pure and DB-free — callers own fetching rules/evidence.
 */
export function buildControlEvidenceRollup(params: {
  rules: PolicyRuleSummary[];
  evidence: Pick<RuntimeDecisionEvidenceRecord, "policyRefs" | "status" | "createdAt">[];
}): ControlEvidenceRollupEntry[] {
  const mappingIndex = buildRuleControlMappingIndex(params.rules);
  const ruleIdsByControl = new Map<
    string,
    {
      framework: PolicyControlMapping["framework"];
      controlId: string;
      rationale?: string;
      stableRuleIds: Set<string>;
    }
  >();

  for (const mapping of mappingIndex) {
    const key = `${mapping.framework}:${mapping.controlId}`;
    const existing = ruleIdsByControl.get(key);
    if (existing) {
      existing.stableRuleIds.add(mapping.stableRuleId);
      if (!existing.rationale && mapping.rationale) existing.rationale = mapping.rationale;
    } else {
      ruleIdsByControl.set(key, {
        framework: mapping.framework,
        controlId: mapping.controlId,
        rationale: mapping.rationale,
        stableRuleIds: new Set([mapping.stableRuleId]),
      });
    }
  }

  const ruleIdToControlKeys = new Map<string, string[]>();
  for (const [key, entry] of ruleIdsByControl) {
    for (const stableRuleId of entry.stableRuleIds) {
      const keys = ruleIdToControlKeys.get(stableRuleId) ?? [];
      keys.push(key);
      ruleIdToControlKeys.set(stableRuleId, keys);
    }
  }

  const rollup = new Map<string, ControlEvidenceRollupEntry>();
  for (const [key, entry] of ruleIdsByControl) {
    rollup.set(key, {
      framework: entry.framework,
      controlId: entry.controlId,
      rationale: entry.rationale,
      stableRuleIds: [...entry.stableRuleIds].sort(),
      decisionCount: 0,
      deniedCount: 0,
      warnedCount: 0,
      latestEvidenceAt: undefined,
    });
  }

  for (const record of params.evidence) {
    const controlKeys = new Set<string>();
    for (const ref of record.policyRefs ?? []) {
      for (const key of ruleIdToControlKeys.get(ref) ?? []) controlKeys.add(key);
    }
    for (const key of controlKeys) {
      const entry = rollup.get(key);
      if (!entry) continue;
      entry.decisionCount += 1;
      if (record.status === "DENY") entry.deniedCount += 1;
      if (record.status === "WARN") entry.warnedCount += 1;
      if (
        !entry.latestEvidenceAt ||
        new Date(record.createdAt).getTime() > new Date(entry.latestEvidenceAt).getTime()
      ) {
        entry.latestEvidenceAt = record.createdAt;
      }
    }
  }

  return [...rollup.values()].sort((a, b) =>
    `${a.framework}:${a.controlId}`.localeCompare(`${b.framework}:${b.controlId}`),
  );
}

/** Validation used by pack fixtures and authoring clients before publish. */
export function validatePolicyControlMappings(rules: PolicyRuleSummary[]) {
  const issues: Array<{ stableRuleId: string; message: string }> = [];
  for (const rule of rules) {
    const seen = new Set<string>();
    for (const mapping of rule.controlMappings ?? []) {
      const controlId = typeof mapping.controlId === "string" ? mapping.controlId.trim() : "";
      const framework = typeof mapping.framework === "string" ? mapping.framework : "";
      if (!controlId)
        issues.push({
          stableRuleId: rule.stableRuleId,
          message: "Control mapping requires a control ID.",
        });
      const key = `${framework}:${controlId}`;
      if (seen.has(key))
        issues.push({
          stableRuleId: rule.stableRuleId,
          message: `Duplicate control mapping ${key}.`,
        });
      seen.add(key);
    }
  }
  return issues;
}

export function evaluatePublishReadiness(params: {
  branchId: string;
  revisionId: string;
  approvalRules: PolicyApprovalRule[];
  approvals: PolicyApproval[];
  verificationSummary?: import("./types").AgtVerificationSummary;
  verificationPolicy?: import("./types").ApprovalVerificationPolicy;
  approvalWorkflow?: import("./types").ApprovalWorkflowSnapshot;
}): PublishReadiness {
  const approved = params.approvals.filter((a) => a.status === "APPROVED");

  const missingRoles: string[] = [];
  for (const rule of params.approvalRules) {
    const count = approved.filter((a) => a.role === rule.role).length;
    if (count < rule.requiredCount) {
      missingRoles.push(rule.role);
    }
  }

  const blockingReasons: PublishBlocker[] = [];
  if (missingRoles.length > 0) {
    blockingReasons.push({
      message: `Missing required approvals from: ${missingRoles.join(", ")}.`,
      href: "#reviews",
      cta: "Open reviews",
    });
  } else if (params.approvalRules.length === 0) {
    blockingReasons.push({
      message: "No approval rules configured.",
      href: "#reviews",
      cta: "Configure approvals",
    });
  }

  const vp = params.verificationPolicy ?? {};
  const requireVerification = vp.requireVerification === true;
  const vs = params.verificationSummary;
  if (requireVerification) {
    if (!vs || !vs.hasResults) {
      blockingReasons.push({
        message: "AGT verification required. No results found for this revision.",
        href: "#verification",
        cta: "Open verification",
      });
    } else {
      if (vp.blockOnFail !== false && vs.overallOutcome === "FAIL") {
        blockingReasons.push({
          message: "AGT verification failed. Address verification issues before publishing.",
          href: "#verification",
          cta: "Open verification",
        });
      }
      if (vp.blockOnStale !== false && vs.isStale) {
        blockingReasons.push({
          message: `AGT verification results are stale (>${vs.staleThresholdDays} days). Re-run verification before publishing.`,
          href: "#verification",
          cta: "Re-run verification",
        });
      }
    }
  }

  const isReady = params.approvalRules.length > 0 && blockingReasons.length === 0;
  return {
    branchId: params.branchId,
    revisionId: params.revisionId,
    isReady,
    status: isReady ? "READY" : "PENDING",
    satisfiedRoles: approved.map((a) => a.role),
    missingRoles,
    blockingReasons,
    approvals: params.approvals,
    verificationStatus: vs,
    approvalWorkflow: params.approvalWorkflow,
  };
}

export function buildPolicyReviewQueue(params: {
  readiness: PublishReadiness;
  createdAt: string;
}): PolicyReviewTask[] {
  return params.readiness.approvals.map((a) => ({
    role: a.role,
    status: a.status,
    requiredCount: 1,
    satisfiedCount: a.status === "APPROVED" ? 1 : 0,
  }));
}

export function buildPolicyImportResult(params: PolicyImportResult): PolicyImportResult {
  return { ...params };
}

const EFFECT_WORDS = new Set([
  "ALLOW",
  "DENY",
  "WARN",
  "ESCALATE",
  "ALLOWED",
  "DENIED",
  "WARNING",
  "ESCALATED",
]);
const NORMALIZED_EFFECTS: Record<string, RuntimeDecisionStatus> = {
  ALLOW: "ALLOW",
  ALLOWED: "ALLOW",
  DENY: "DENY",
  DENIED: "DENY",
  ESCALATE: "ESCALATE",
  ESCALATED: "ESCALATE",
  WARN: "WARN",
  WARNING: "WARN",
};
const KNOWN_RULE_FIELDS = new Set([
  "id",
  "stable_rule_id",
  "stableRuleId",
  "name",
  "title",
  "description",
  "message",
  "effect",
  "action",
  "decision",
  "result",
  "domains",
  "connectors",
  "tools",
  "actions",
  "condition",
  "conditions",
  "priority",
  "immutable",
  "semantic_checks",
  "semanticChecks",
  "parameter_constraints",
  "parameterConstraints",
  "control_mappings",
  "controlMappings",
  "dynamic_conditions",
  "dynamicConditions",
  "time_window",
  "timeWindow",
  "daily_spend_limit",
  "dailySpendLimit",
  "per_call_cost_limit",
  "perCallCostLimit",
  "session_cumulative_cost_limit",
  "sessionCumulativeCostLimit",
  "budget_utilization_threshold",
  "budgetUtilizationThreshold",
]);
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "metadata",
  "rules",
  "policies",
  "defaults",
  "name",
  "version",
  "description",
  "disclaimer",
]);
const AGT_NATIVE_DYNAMIC_CONDITION_FIELDS: Array<[string, PolicyDynamicCondition["kind"]]> = [
  ["time_window", "TIME_WINDOW"],
  ["timeWindow", "TIME_WINDOW"],
  ["daily_spend_limit", "DAILY_SPEND_LIMIT"],
  ["dailySpendLimit", "DAILY_SPEND_LIMIT"],
  ["per_call_cost_limit", "PER_CALL_COST_LIMIT"],
  ["perCallCostLimit", "PER_CALL_COST_LIMIT"],
  ["session_cumulative_cost_limit", "SESSION_CUMULATIVE_COST_LIMIT"],
  ["sessionCumulativeCostLimit", "SESSION_CUMULATIVE_COST_LIMIT"],
  ["budget_utilization_threshold", "BUDGET_UTILIZATION_THRESHOLD"],
  ["budgetUtilizationThreshold", "BUDGET_UTILIZATION_THRESHOLD"],
];

export function parseAgtPolicyDocument(params: {
  document: string;
  sourcePath?: string;
}): PolicyImportResult {
  const content = params.document.trim();
  const diagnostics: PolicyRuleDiagnostic[] = [];
  const rules: PolicyRuleSummary[] = [];
  const warnings: string[] = [];
  let metadata: Record<string, unknown> = {};

  let parsed: unknown;
  try {
    const isJson = content.startsWith("{") || content.startsWith("[");
    parsed = isJson ? JSON.parse(content) : yaml.load(content);
  } catch (e) {
    diagnostics.push({
      severity: "ERROR",
      message: `Failed to parse policy document: ${String(e)}`,
    });
    return { sourceHash: "pending", rules, diagnostics, metadata, warnings };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      severity: "ERROR",
      message: "Policy document must be an object with metadata and rules.",
    });
    return { sourceHash: "pending", rules, diagnostics, metadata, warnings };
  }

  const doc = parsed as Record<string, unknown>;
  metadata =
    doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
      ? (doc.metadata as Record<string, unknown>)
      : {};

  const rawRules = collectRawRules(doc);
  if (!rawRules.length) {
    warnings.push("No rules found in policy document.");
  }

  for (const r of rawRules) {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      diagnostics.push({ severity: "WARNING", message: "Skipping non-object rule entry." });
      continue;
    }
    const rule = r as Record<string, unknown>;
    const stableRuleId =
      (typeof rule.stable_rule_id === "string" && rule.stable_rule_id) ||
      (typeof rule.stableRuleId === "string" && rule.stableRuleId) ||
      (typeof rule.id === "string" && rule.id) ||
      (typeof rule.name === "string" && rule.name);
    if (!stableRuleId) {
      diagnostics.push({
        severity: "ERROR",
        message: "Rule missing stable_rule_id — skipped.",
        ruleId: undefined,
      });
      continue;
    }
    const rawEffect = inferEffect(rule);
    const effect = NORMALIZED_EFFECTS[rawEffect] ?? "ALLOW";
    if (!NORMALIZED_EFFECTS[rawEffect]) {
      diagnostics.push({
        severity: "WARNING",
        message: `Rule "${stableRuleId}" has unrecognised effect "${rule.effect}", defaulting to ALLOW.`,
        ruleId: stableRuleId,
      });
    }
    const preservedFields = Object.fromEntries(
      Object.entries(rule).filter(([key]) => !KNOWN_RULE_FIELDS.has(key)),
    );
    const conditions = collectConditions(rule);
    const dynamicConditions = collectDynamicConditions(rule, conditions);
    rules.push({
      stableRuleId,
      title:
        typeof rule.title === "string"
          ? rule.title
          : typeof rule.description === "string"
            ? rule.description
            : stableRuleId,
      effect,
      sourceFormat: "AGT_YAML",
      sourcePath: params.sourcePath,
      domains: uniqueStrings([...stringArray(rule.domains), ...stringArray(rule.tools)]),
      connectors: uniqueStrings([...stringArray(rule.connectors), ...stringArray(rule.tools)]),
      actions: inferActions(rule, conditions),
      immutable: rule.immutable === true,
      priority: typeof rule.priority === "number" ? rule.priority : undefined,
      conditions,
      dynamicConditions,
      semanticChecks: collectSemanticChecks(rule, stableRuleId),
      controlMappings: collectControlMappings(rule),
      parameterConstraints: collectParameterConstraints(rule),
      originalRule: rule,
      preservedFields: Object.keys(preservedFields).length ? preservedFields : undefined,
    });
  }

  const compatibility = buildAgtCompatibilityReport({ doc, rules, warnings });
  if (compatibility.preservedTopLevelKeys.length || compatibility.preservedRuleFieldCount > 0) {
    diagnostics.push({
      severity: "INFO",
      message:
        "Preserved AGT-native fields for round-trip export and verification even when Spctre does not edit them directly.",
    });
  }

  return {
    sourceHash: "pending",
    rules,
    diagnostics,
    metadata,
    warnings,
    sourceDocument: doc,
    compatibility,
  };
}

const NATIVE_TRANSLATOR_VERSION = "1";
const REGISTERED_CEDAR_CONNECTORS = new Set<string>(CANONICAL_PACK_CONNECTORS);

/** Infer a policy dialect without treating an arbitrary YAML document as native source. */
export function detectPolicySourceFormat(params: {
  document: string;
  sourcePath?: string;
}): Extract<PolicySourceDialect, "AGT_YAML" | "OPA_REGO" | "CEDAR"> {
  const path = params.sourcePath?.toLowerCase() ?? "";
  if (path.endsWith(".rego")) return "OPA_REGO";
  if (path.endsWith(".cedar")) return "CEDAR";
  const source = params.document.trim();
  if (/^(permit|forbid)\s*\(/m.test(source)) return "CEDAR";
  if (/^package\s+[\w./-]+/m.test(source) && /\b(?:allow|deny)\b/.test(source)) return "OPA_REGO";
  return "AGT_YAML";
}

/**
 * Parses AGT YAML/JSON directly or translates the intentionally small,
 * deterministic native-source subset accepted at import time. Unsupported
 * source is reported rather than guessed or weakened.
 */
export function parsePolicySourceDocument(params: {
  document: string;
  sourcePath?: string;
  sourceFormat?: Extract<PolicySourceDialect, "AGT_YAML" | "OPA_REGO" | "CEDAR">;
}): PolicyImportResult {
  const requestedFormat = params.sourceFormat;
  if (
    requestedFormat !== undefined &&
    requestedFormat !== "AGT_YAML" &&
    requestedFormat !== "OPA_REGO" &&
    requestedFormat !== "CEDAR"
  ) {
    return {
      sourceHash: "pending",
      rules: [],
      diagnostics: [
        { severity: "ERROR", message: "sourceFormat must be AGT_YAML, OPA_REGO, or CEDAR." },
      ],
      warnings: [],
      metadata: {},
    };
  }
  const sourceFormat = requestedFormat ?? detectPolicySourceFormat(params);
  if (sourceFormat === "AGT_YAML") return parseAgtPolicyDocument(params);

  const translated =
    sourceFormat === "CEDAR"
      ? translateCedarSource(params.document)
      : translateRegoSource(params.document);
  const translation: PolicySourceTranslationReport = {
    sourceFormat,
    translatorVersion: NATIVE_TRANSLATOR_VERSION,
    status: translated.unsupported ? "UNSUPPORTED" : translated.lossy ? "LOSSY" : "EXACT",
    mappings: translated.mappings,
    diagnostics: translated.diagnostics,
  };
  if (translated.unsupported) {
    return {
      sourceHash: "pending",
      sourceFormat,
      rules: [],
      diagnostics: translated.diagnostics,
      warnings: [],
      metadata: {},
      translation,
    };
  }

  const sourceDocument = {
    metadata: {
      name: `${sourceFormat.toLowerCase()}-import`,
      sourceFormat,
      translatorVersion: NATIVE_TRANSLATOR_VERSION,
    },
    rules: translated.rules,
  };
  const parsed = parseAgtPolicyDocument({
    document: JSON.stringify(sourceDocument),
    sourcePath: params.sourcePath,
  });
  return {
    ...parsed,
    sourceFormat,
    rules: parsed.rules.map((rule) => ({ ...rule, sourceFormat })),
    sourceDocument,
    diagnostics: [...translated.diagnostics, ...parsed.diagnostics],
    warnings: [
      ...translated.diagnostics
        .filter((diagnostic) => diagnostic.severity === "WARNING")
        .map((diagnostic) => diagnostic.message),
      ...parsed.warnings,
    ],
    translation,
  };
}

type NativeTranslation = {
  rules: Record<string, unknown>[];
  mappings: PolicySourceTranslationMapping[];
  diagnostics: PolicyRuleDiagnostic[];
  unsupported: boolean;
  lossy: boolean;
};

function unsupportedNativeSource(message: string): NativeTranslation {
  return {
    rules: [],
    mappings: [],
    diagnostics: [{ severity: "ERROR", message }],
    unsupported: true,
    lossy: false,
  };
}

/** Remove line comments without interpreting comment markers inside strings. */
function stripLineComments(source: string, markers: string[]): string {
  let result = "";
  let quote: '"' | "`" | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      result += char;
      if (quote === '"' && escaped) escaped = false;
      else if (quote === '"' && char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "`") {
      quote = char;
      result += char;
      continue;
    }
    const marker = markers.find((candidate) => source.startsWith(candidate, index));
    if (marker) {
      while (index < source.length && source[index] !== "\n") index += 1;
      if (index < source.length) result += "\n";
      continue;
    }
    result += char;
  }
  return result;
}

function translateCedarSource(source: string): NativeTranslation {
  const withoutComments = stripLineComments(source, ["//"]).trim();
  // Cedar defaults to deny whereas the current AGT evaluator defaults to
  // allow. A Cedar `permit` statement therefore cannot be represented exactly
  // without a branch-level default-effect feature; accept only forbids.
  const statement =
    /\b(forbid)\s*\(\s*principal\s*,\s*action\s*==\s*Action::"([^"\\]+)"\s*,\s*resource\s*\)\s*;/g;
  const rules: Record<string, unknown>[] = [];
  const mappings: PolicySourceTranslationMapping[] = [];
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = statement.exec(withoutComments))) {
    if (withoutComments.slice(last, match.index).trim()) {
      return unsupportedNativeSource(
        'Unsupported Cedar syntax. The initial importer accepts standalone forbid statements with an Action::"connector.action" selector only; permit relies on Cedar\'s default-deny semantics.',
      );
    }
    const [connector, ...actionParts] = match[2].split(".");
    if (!connector || !actionParts.length || actionParts.some((part) => !part)) {
      return unsupportedNativeSource(
        `Cedar action "${match[2]}" must use Action::\"connector.action\".`,
      );
    }
    if (!REGISTERED_CEDAR_CONNECTORS.has(connector)) {
      return unsupportedNativeSource(
        `Cedar action "${match[2]}" has no registered Spctre connector prefix. Use Action::\"<registered-connector>.<action>\" or author this rule in AGT_YAML.`,
      );
    }
    const stableRuleId = `cedar.${connector}.${actionParts.join(".")}.${rules.length + 1}`;
    rules.push({
      stable_rule_id: stableRuleId,
      title: `Deny ${match[2]}`,
      effect: "DENY",
      connectors: [connector],
      actions: [actionParts.join(".")],
    });
    mappings.push({
      sourceId: `cedar:${rules.length}`,
      stableRuleId,
      outcome: "LOSSY",
      message:
        "Spctre action matching is prefix-based; Cedar action equality may match additional action names.",
    });
    last = statement.lastIndex;
  }
  if (!rules.length || withoutComments.slice(last).trim()) {
    return unsupportedNativeSource(
      "Unsupported Cedar syntax. No supported standalone forbid statements were found.",
    );
  }
  return {
    rules,
    mappings,
    diagnostics: [
      {
        severity: "WARNING",
        message:
          "Cedar action equality is translated to Spctre's prefix action matching and is therefore lossy.",
      },
    ],
    unsupported: false,
    lossy: true,
  };
}

function translateRegoSource(source: string): NativeTranslation {
  const withoutComments = stripLineComments(source, ["#", "//"]).trim();
  const packageMatch = /^\s*package\s+([\w./-]+)\s*$/m.exec(withoutComments);
  if (!packageMatch) return unsupportedNativeSource("Rego source must declare a package.");
  // Rego `allow` rules commonly rely on OPA's default-deny decision contract,
  // which Spctre cannot reproduce without a branch-level default effect. The
  // exact initial subset is deny-only and uses Spctre's deny-override model.
  const body = withoutComments
    .replace(/^\s*package\s+[\w./-]+\s*$/m, "")
    .replace(/^\s*import\s+rego\.v1\s*$/gm, "")
    .replace(/^\s*default\s+deny\s*:?=\s*false\s*$/gm, "")
    .trim();
  const rulePattern = /\b(deny)\s+if\s*\{([^{}]*)\}/g;
  const rules: Record<string, unknown>[] = [];
  const mappings: PolicySourceTranslationMapping[] = [];
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = rulePattern.exec(body))) {
    const gap = body.slice(last, match.index).trim();
    if (gap) {
      return unsupportedNativeSource(
        "Unsupported Rego syntax. The initial importer accepts a package declaration, optional import rego.v1/default deny := false, and deny if blocks with input selector comparisons; allow/default decision contracts are not yet representable.",
      );
    }
    const selectors: Record<string, string> = {};
    for (const expression of match[2]
      .split(/[;\n]/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const comparison =
        /^input\.(connector|action|domain)\s*==\s*(?:"([^"\\]+)"|`([^`\r\n]*)`)$/.exec(expression);
      if (!comparison || selectors[comparison[1]]) {
        return unsupportedNativeSource(
          `Unsupported Rego expression "${expression}". Use conjunctions of input.connector, input.action, and input.domain equality checks.`,
        );
      }
      selectors[comparison[1]] = comparison[2] ?? comparison[3];
    }
    if (!selectors.connector && !selectors.action && !selectors.domain) {
      return unsupportedNativeSource(
        "Rego rules must include at least one supported input selector.",
      );
    }
    // The kernel treats absent evidence.domains as a domain match. A domain-only
    // rule would therefore deny every connector/action whose evidence omits a
    // domain; require a connector or action selector to retain a hard target.
    if (selectors.domain && !selectors.connector && !selectors.action) {
      return unsupportedNativeSource(
        "Rego domain selectors must be paired with input.connector or input.action; domain-only rules can match evidence with no domains.",
      );
    }
    const stableRuleId = `rego.${packageMatch[1].replace(/[^a-zA-Z0-9]+/g, ".")}.${match[1]}.${rules.length + 1}`;
    rules.push({
      stable_rule_id: stableRuleId,
      title: `Deny ${selectors.action ?? selectors.connector ?? selectors.domain}`,
      effect: "DENY",
      connectors: selectors.connector ? [selectors.connector] : [],
      actions: selectors.action ? [selectors.action] : [],
      domains: selectors.domain ? [selectors.domain] : [],
    });
    mappings.push({
      sourceId: `rego:${match[1]}:${rules.length}`,
      stableRuleId,
      outcome: "LOSSY",
      message:
        "Spctre action matching is prefix-based; Rego action equality may match additional action names.",
    });
    last = rulePattern.lastIndex;
  }
  if (!rules.length || body.slice(last).trim()) {
    return unsupportedNativeSource(
      "Unsupported Rego syntax. No supported deny if blocks were found.",
    );
  }
  return {
    rules,
    mappings,
    diagnostics: [
      {
        severity: "WARNING",
        message:
          "Rego action equality is translated to Spctre's prefix action matching and is therefore lossy.",
      },
    ],
    unsupported: false,
    lossy: true,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function collectRawRules(doc: Record<string, unknown>): unknown[] {
  if (Array.isArray(doc.rules)) return doc.rules;
  if (Array.isArray(doc.policies)) {
    return doc.policies.flatMap((policy) => {
      if (policy && typeof policy === "object" && !Array.isArray(policy)) {
        const rules = (policy as Record<string, unknown>).rules;
        return Array.isArray(rules) ? rules : [];
      }
      return [];
    });
  }
  return [];
}

function inferEffect(rule: Record<string, unknown>): string {
  for (const key of ["effect", "decision", "result", "action"]) {
    const value = rule[key];
    if (typeof value === "string") {
      const normalized = value.toUpperCase();
      if (EFFECT_WORDS.has(normalized)) return normalized;
    }
  }
  return "ALLOW";
}

function collectConditions(rule: Record<string, unknown>): Record<string, unknown>[] {
  const conditions: Record<string, unknown>[] = [];
  const condition = rule.condition;
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    conditions.push(condition as Record<string, unknown>);
  }
  if (Array.isArray(rule.conditions)) {
    for (const item of rule.conditions) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        conditions.push(item as Record<string, unknown>);
      }
    }
  }
  return conditions;
}

function collectDynamicConditions(
  rule: Record<string, unknown>,
  conditions: Record<string, unknown>[],
): PolicyDynamicCondition[] | undefined {
  const dynamicConditions: PolicyDynamicCondition[] = [];
  const seenNativeKinds = new Set<PolicyDynamicCondition["kind"]>();
  for (const condition of conditions) {
    const classified = classifyDynamicCondition(condition);
    if (classified) dynamicConditions.push(classified);
  }

  for (const [field, kind] of AGT_NATIVE_DYNAMIC_CONDITION_FIELDS) {
    if (seenNativeKinds.has(kind)) continue;
    const value = rule[field];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      seenNativeKinds.add(kind);
      dynamicConditions.push({
        kind,
        source: "AGT_NATIVE_FIELD",
        value,
        window: kind === "TIME_WINDOW" ? (value as Record<string, unknown>) : undefined,
        originalCondition: { [field]: value },
      });
    } else if (value !== undefined) {
      seenNativeKinds.add(kind);
      dynamicConditions.push({
        kind,
        source: "AGT_NATIVE_FIELD",
        value,
        originalCondition: { [field]: value },
      });
    }
  }

  return dynamicConditions.length ? dynamicConditions : undefined;
}

function classifyDynamicCondition(
  condition: Record<string, unknown>,
): PolicyDynamicCondition | undefined {
  const explicitType = stringValue(
    condition.type ?? condition.kind ?? condition.condition_type ?? condition.conditionType,
  );
  const field = stringValue(condition.field);
  const operator = stringValue(condition.operator);
  const value = condition.value;
  const probe = [explicitType, field, stringValue(condition.metric), stringValue(condition.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let kind: PolicyDynamicCondition["kind"] | undefined;
  if (/\b(time|timestamp|current_time|time_window|business_hours|schedule)\b/.test(probe)) {
    kind = "TIME_WINDOW";
  } else if (/\bdaily[_ -]?(spend|cost|budget|limit)\b/.test(probe)) {
    kind = "DAILY_SPEND_LIMIT";
  } else if (/\b(per[_ -]?call|call)[_ -]?(cost|spend|limit)\b/.test(probe)) {
    kind = "PER_CALL_COST_LIMIT";
  } else if (/\b(session|cumulative)[_ -]?(cost|spend|limit)\b/.test(probe)) {
    kind = "SESSION_CUMULATIVE_COST_LIMIT";
  } else if (/\b(budget[_ -]?utilization|utilization|budget[_ -]?threshold)\b/.test(probe)) {
    kind = "BUDGET_UTILIZATION_THRESHOLD";
  }
  if (!kind && typeof field === "string") {
    if (["estimated_cost_usd", "cost_usd", "cost", "amount_usd"].includes(field))
      kind = "PER_CALL_COST_LIMIT";
    if (["session_cost_usd", "session_spend_usd", "cumulative_cost_usd"].includes(field))
      kind = "SESSION_CUMULATIVE_COST_LIMIT";
    if (["daily_spend_usd", "daily_cost_usd"].includes(field)) kind = "DAILY_SPEND_LIMIT";
    if (["budget_utilization", "budget_utilization_percent"].includes(field))
      kind = "BUDGET_UTILIZATION_THRESHOLD";
  }
  if (!kind) return undefined;
  return {
    kind,
    source: "AGT_CONDITION",
    field,
    operator,
    value,
    window:
      kind === "TIME_WINDOW" && value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined,
    originalCondition: condition,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function collectControlMappings(rule: Record<string, unknown>): PolicyControlMapping[] | undefined {
  const raw = rule.control_mappings ?? rule.controlMappings;
  if (!Array.isArray(raw)) return undefined;
  const frameworks = new Set([
    "SOC2",
    "HIPAA",
    "ISO_27001",
    "ISO_42001",
    "EU_AI_ACT",
    "NIST_AI_RMF",
    "OWASP_AGENTIC",
  ]);
  const mappings = raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const framework = typeof value.framework === "string" ? value.framework : "";
    const controlId =
      typeof value.control_id === "string"
        ? value.control_id
        : typeof value.controlId === "string"
          ? value.controlId
          : "";
    return frameworks.has(framework) && controlId
      ? [
          {
            framework: framework as PolicyControlMapping["framework"],
            controlId,
            rationale: typeof value.rationale === "string" ? value.rationale : undefined,
          },
        ]
      : [];
  });
  return mappings.length ? mappings : undefined;
}

const PARAMETER_CONSTRAINT_OPERATORS = new Set([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
]);

function collectParameterConstraints(
  rule: Record<string, unknown>,
): PolicyParameterConstraint[] | undefined {
  const raw = rule.parameter_constraints ?? rule.parameterConstraints;
  if (!Array.isArray(raw)) return undefined;
  const constraints = raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const field = typeof value.field === "string" ? value.field : "";
    const operator = typeof value.operator === "string" ? value.operator : "";
    if (!field || !PARAMETER_CONSTRAINT_OPERATORS.has(operator)) return [];
    const rawEffect = typeof value.effect === "string" ? value.effect.toUpperCase() : undefined;
    const effect =
      rawEffect && NORMALIZED_EFFECTS[rawEffect] ? NORMALIZED_EFFECTS[rawEffect] : undefined;
    const parameterKey =
      typeof value.parameter_key === "string"
        ? value.parameter_key
        : typeof value.parameterKey === "string"
          ? value.parameterKey
          : undefined;
    return [
      {
        field,
        operator: operator as PolicyParameterConstraint["operator"],
        value: value.value,
        parameterKey,
        effect,
      },
    ];
  });
  return constraints.length ? constraints : undefined;
}

function collectSemanticChecks(
  rule: Record<string, unknown>,
  stableRuleId: string,
): SemanticCheck[] | undefined {
  const raw = rule.semantic_checks ?? rule.semanticChecks;
  if (!Array.isArray(raw)) return undefined;

  const checks: SemanticCheck[] = [];
  raw.forEach((item, index) => {
    if (typeof item === "string" && item.trim()) {
      checks.push({ id: `sem-${stableRuleId}-${index}`, prompt: item.trim() });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
      if (prompt) {
        const id =
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : `sem-${stableRuleId}-${index}`;
        const rawEffect = typeof item.effect === "string" ? item.effect.toUpperCase() : undefined;
        const effect =
          rawEffect && NORMALIZED_EFFECTS[rawEffect] ? NORMALIZED_EFFECTS[rawEffect] : undefined;
        checks.push({ id, prompt, effect });
      }
    }
  });

  return checks.length ? checks : undefined;
}

function inferActions(
  rule: Record<string, unknown>,
  conditions: Record<string, unknown>[],
): string[] {
  const explicitActions = stringArray(rule.actions);
  const rawAction =
    typeof rule.action === "string" && !EFFECT_WORDS.has(rule.action.toUpperCase())
      ? [rule.action]
      : [];
  const conditionActions = conditions.flatMap((condition) => {
    const field = typeof condition.field === "string" ? condition.field : "";
    if (!["action", "tool_name", "tool", "resource", "operation"].includes(field)) return [];
    const value = condition.value;
    if (typeof value === "string") return [value];
    return stringArray(value);
  });
  return uniqueStrings([...explicitActions, ...rawAction, ...conditionActions]);
}

function buildAgtCompatibilityReport(params: {
  doc: Record<string, unknown>;
  rules: PolicyRuleSummary[];
  warnings: string[];
}): AgtCompatibilityReport {
  const preservedTopLevelKeys = Object.keys(params.doc).filter(
    (key) => !KNOWN_TOP_LEVEL_FIELDS.has(key),
  );
  const preservedRuleFieldCount = params.rules.reduce(
    (acc, rule) => acc + Object.keys(rule.preservedFields ?? {}).length,
    0,
  );
  const hasConditions = params.rules.some((rule) => (rule.conditions?.length ?? 0) > 0);
  const dynamicConditionCount = params.rules.reduce(
    (acc, rule) => acc + (rule.dynamicConditions?.length ?? 0),
    0,
  );
  const provenance = extractAgtEngineProvenance(params.doc);
  const semanticWarnings = [
    ...params.warnings,
    ...(hasConditions
      ? [
          "AGT conditions are preserved losslessly; Spctre maps common action/tool conditions for preview evaluation.",
        ]
      : []),
    ...(dynamicConditionCount > 0
      ? [
          "AGT v4.1.0 dynamic time and cost conditions are typed for review and preserved for runtime verification.",
        ]
      : []),
  ];

  return {
    dialect: "AGT_YAML",
    compatibilityLevel:
      preservedRuleFieldCount > 0 || preservedTopLevelKeys.length > 0
        ? "LOSSLESS_PRESERVED"
        : hasConditions
          ? "PARTIAL_SEMANTIC_MAP"
          : "NATIVE",
    ...provenance,
    compatibilityCheckedAt: new Date().toISOString(),
    compatibilityCheckOutcome: semanticWarnings.length ? "WARN" : "PASS",
    preservedTopLevelKeys,
    preservedRuleFieldCount,
    dynamicConditionCount,
    semanticWarnings,
    verificationTargets: [
      "agt lint-policy",
      "agt verify --evidence",
      "agt verify --evidence --strict",
    ],
  };
}

function extractAgtEngineProvenance(doc: Record<string, unknown>): Partial<AgtCompatibilityReport> {
  const agt =
    doc.agt && typeof doc.agt === "object" && !Array.isArray(doc.agt)
      ? (doc.agt as Record<string, unknown>)
      : {};
  const metadata =
    doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
      ? (doc.metadata as Record<string, unknown>)
      : {};
  const engine =
    agt.engine && typeof agt.engine === "object" && !Array.isArray(agt.engine)
      ? (agt.engine as Record<string, unknown>)
      : {};
  return {
    agtVersion: stringValue(agt.version ?? metadata.agtVersion ?? metadata.agt_version),
    agtPoliciesVersion: stringValue(
      agt.policies_version ??
        agt.agt_policies_version ??
        metadata.agtPoliciesVersion ??
        metadata.agt_policies_version,
    ),
    cedarPolicyVersion: stringValue(
      agt.cedar_policy_version ?? metadata.cedarPolicyVersion ?? metadata.cedar_policy_version,
    ),
    policyEngineVersion: stringValue(
      agt.policy_engine_version ??
        engine.version ??
        metadata.policyEngineVersion ??
        metadata.policy_engine_version,
    ),
  };
}

export function toAgtCompatiblePolicyBundle(
  params: AgtCompatiblePolicyBundle,
): AgtCompatiblePolicyBundle {
  const compatibility =
    params.compatibility ??
    buildAgtCompatibilityReport({
      doc: params.sourceDocument ?? { metadata: params.metadata, rules: params.rules },
      rules: params.rules,
      warnings: [],
    });
  return {
    ...params,
    compatibility,
    metadata: {
      ...params.metadata,
      spctre_agt_compatibility: compatibility,
      agt_version: compatibility.agtVersion,
      agt_policies_version: compatibility.agtPoliciesVersion,
      cedar_policy_version: compatibility.cedarPolicyVersion,
      policy_engine_version: compatibility.policyEngineVersion,
      compatibility_checked_at: compatibility.compatibilityCheckedAt,
      compatibility_check_outcome: compatibility.compatibilityCheckOutcome,
    },
  };
}

export function ingestAgtRuntimeDecision(
  input: AgtRuntimeDecisionInput,
): RuntimeDecisionEvidenceRecord {
  return input;
}

export function evaluateGatewayDecision(input: GatewayDecisionInput): GatewayDecisionResult {
  return JSON.parse(
    jsEvaluateGatewayDecision(
      JSON.stringify({
        reason: input.reason ?? null,
        consequence: input.consequence ?? null,
        confidence: input.confidence ?? null,
        amountUsd: input.amountUsd ?? null,
        dataSensitivity: input.dataSensitivity ?? null,
        trustScore: input.trustScore ?? null,
      }),
    ),
  ) as GatewayDecisionResult;
}

export function evaluateRuntimePolicyDecision(input: {
  connector: string;
  action: string;
  domains?: string[];
  runtimeTarget?: RuntimeDecisionEvidenceRecord["runtimeTarget"];
  executionContext?: RuntimeDecisionEvidenceRecord["executionContext"];
  orchestratorRef?: RuntimeDecisionEvidenceRecord["orchestratorRef"];
  skillContext?: RuntimeDecisionEvidenceRecord["skillContext"];
  triggerKind?: RuntimeDecisionEvidenceRecord["triggerKind"];
  layer?: RuntimeDecisionEvidenceRecord["layer"];
  trustLevel?: string;
  pluginSource?: RuntimeDecisionEvidenceRecord["pluginSource"];
  catalogProvider?: string;
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
  policyArtifactHash?: string;
  rules: PolicyRuleSummary[];
  evaluatedAt?: string;
}): EvaluationResult {
  return JSON.parse(
    jsEvaluatePolicyDecision(
      JSON.stringify({
        connector: input.connector,
        action: input.action,
        domains: input.domains ?? [],
        runtimeTarget: input.runtimeTarget ?? null,
        executionContext: input.executionContext ?? null,
        orchestratorRef: input.orchestratorRef ?? null,
        skillContext: input.skillContext ?? null,
        triggerKind: input.triggerKind ?? null,
        layer: input.layer ?? null,
        trustLevel: input.trustLevel ?? null,
        pluginSource: input.pluginSource ?? null,
        catalogProvider: input.catalogProvider ?? null,
        toolIntent: input.toolIntent ?? "",
        planSummary: input.planSummary ?? "",
        toolParameters: input.toolParameters ?? {},
        policyArtifactHash: input.policyArtifactHash ?? null,
        rules: input.rules.map((rule) => ({
          stableRuleId: rule.stableRuleId,
          title: rule.title,
          effect: rule.effect,
          domains: rule.domains,
          connectors: rule.connectors,
          actions: rule.actions,
          immutable: rule.immutable,
          semanticChecks: rule.semanticChecks ?? [],
          parameterConstraints: rule.parameterConstraints ?? [],
          runtimeStacks: rule.runtimeStacks ?? [],
          sandboxNames: rule.sandboxNames ?? [],
          inferenceProviders: rule.inferenceProviders ?? [],
          orchestratorPlatforms: rule.orchestratorPlatforms ?? [],
          companyIds: rule.companyIds ?? [],
          issueIds: rule.issueIds ?? [],
          goalIds: rule.goalIds ?? [],
          triggerKind: rule.triggerKind ?? null,
          layer: rule.layer ?? null,
          trustLevels: rule.trustLevels ?? [],
          pluginSources: rule.pluginSources ?? [],
          skillIds: rule.skillIds ?? [],
          promptSurfaces: rule.promptSurfaces ?? [],
          catalogProviders: rule.catalogProviders ?? [],
        })),
        evaluatedAt: input.evaluatedAt ?? null,
      }),
    ),
  ) as EvaluationResult;
}

export function buildHeartbeatEvidence(params: {
  agentId: string;
  workspaceId: string;
  artifactHash: string;
}): AgtRuntimeDecisionInput {
  return {
    decisionId: `hb-${Date.now()}`,
    tenantId: "tenant-demo",
    workspaceId: params.workspaceId,
    environment: "production",
    runtimeTarget: { stack: "LOCAL" },
    agentId: params.agentId,
    connector: "system",
    action: "heartbeat",
    status: "ALLOW",
    reason: "Standard boot-up heartbeat.",
    policyRefs: ["system.heartbeat"],
    artifactHash: params.artifactHash,
    policyContext: [],
    latencyMs: 0,
    createdAt: new Date().toISOString(),
    rawEvidence: {},
  };
}

/** Compare a runtime heartbeat with the artifact currently published for it. */
export function evaluateRuntimePolicyDrift(params: {
  agentId: string;
  runtimeArtifactHash?: string;
  publishedArtifactHash: string;
}) {
  const runtimeArtifactHash = params.runtimeArtifactHash?.trim();
  if (!runtimeArtifactHash)
    return {
      status: "PROVENANCE_GAP" as const,
      agentId: params.agentId,
      reason: "Runtime heartbeat did not report a policy artifact hash.",
    };
  if (runtimeArtifactHash !== params.publishedArtifactHash)
    return {
      status: "DRIFTED" as const,
      agentId: params.agentId,
      reason: "Runtime artifact hash differs from the published artifact.",
      runtimeArtifactHash,
      publishedArtifactHash: params.publishedArtifactHash,
    };
  return {
    status: "CURRENT" as const,
    agentId: params.agentId,
    reason: "Runtime is enforcing the published artifact.",
    runtimeArtifactHash,
    publishedArtifactHash: params.publishedArtifactHash,
  };
}

/** Bounded inventory classification; it deliberately does not discover assets. */
export function mapRuntimeProvenanceGaps(params: {
  publishedArtifactHash: string;
  runtimes: Array<{
    agentId: string;
    runtimeTarget: string;
    artifactHash?: string;
    policyContextPresent: boolean;
  }>;
}) {
  return params.runtimes.map((runtime) => {
    const drift = evaluateRuntimePolicyDrift({
      agentId: runtime.agentId,
      runtimeArtifactHash: runtime.artifactHash,
      publishedArtifactHash: params.publishedArtifactHash,
    });
    return {
      ...runtime,
      coverage:
        runtime.policyContextPresent && drift.status === "CURRENT"
          ? ("GOVERNED" as const)
          : ("PROVENANCE_GAP" as const),
      driftStatus: drift.status,
    };
  });
}

export function summarizeRuntimePolicyCoverage(
  params: Parameters<typeof mapRuntimeProvenanceGaps>[0],
) {
  const runtimes = mapRuntimeProvenanceGaps(params);
  return {
    runtimes,
    total: runtimes.length,
    governed: runtimes.filter((runtime) => runtime.coverage === "GOVERNED").length,
    provenanceGaps: runtimes.filter((runtime) => runtime.coverage === "PROVENANCE_GAP").length,
    drifted: runtimes.filter((runtime) => runtime.driftStatus === "DRIFTED").length,
  };
}

/**
 * Evaluates published rules against a request.
 *
 * This is a transport onto the kernel, not an evaluator. It existed as a second
 * full implementation of matching, semantic checks, parameter constraints and
 * effect precedence, which meant authoring, simulation and the offline hook could
 * each answer a policy question differently from the runtime that enforces it.
 * There is now one answer.
 */
export function evaluateDecision(params: {
  connector: string;
  action: string;
  domains?: string[];
  rules: PolicyRuleSummary[];
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
}): EvaluationResult {
  return evaluateRuntimePolicyDecision(params);
}

/** Deterministic bounded inspection for connector tool payloads. */
export function evaluateConnectorPayloadGuardrail(params: {
  connector: string;
  action: string;
  domains?: string[];
  rules: PolicyRuleSummary[];
  toolIntent?: string;
  planSummary?: string;
  toolParameters?: Record<string, unknown>;
}) {
  const parameters = params.toolParameters ?? {};
  const serialized = JSON.stringify(parameters);
  if (serialized.length > 32_768) {
    return {
      status: "DENY" as const,
      reason: "Connector payload exceeds the 32 KiB governed inspection limit.",
      matchedPolicyRefs: ["system.payload_size_limit"],
      payloadHash: sha256(serialized),
    };
  }
  const result = evaluateDecision({ ...params, toolParameters: parameters });
  return {
    status: result.status,
    reason: result.reason,
    matchedPolicyRefs: result.matchedRefs,
    payloadHash: sha256(serialized),
  };
}

/**
 * Applies workspace-level parameter overrides (keyed by
 * PolicyParameterConstraint.parameterKey) to a set of rules without mutating
 * the originals. Pure — the caller owns persistence of the override map.
 */
export function applyPackParameterOverrides(
  rules: PolicyRuleSummary[],
  overrides: Record<string, unknown>,
): PolicyRuleSummary[] {
  if (!overrides || Object.keys(overrides).length === 0) return rules;
  return rules.map((rule) => {
    if (!rule.parameterConstraints || rule.parameterConstraints.length === 0) return rule;
    let changed = false;
    const parameterConstraints = rule.parameterConstraints.map((constraint) => {
      if (!constraint.parameterKey || !(constraint.parameterKey in overrides)) return constraint;
      changed = true;
      return { ...constraint, value: overrides[constraint.parameterKey] };
    });
    return changed ? { ...rule, parameterConstraints } : rule;
  });
}

export function validateBundleCompatibility(params: {
  bundle: AgtCompatiblePolicyBundle;
  adapters: AdapterCapabilityDeclaration[];
}): BundleCompatibilityReport {
  const { bundle, adapters } = params;
  const bundleConnectors = new Set(bundle.rules.flatMap((r) => r.connectors));
  const gaps: BundleCompatibilityGap[] = [];

  for (const adapter of adapters) {
    const uncovered = adapter.supportedConnectors.filter((c) => !bundleConnectors.has(c));
    if (uncovered.length > 0) {
      gaps.push({
        adapterId: adapter.adapterId,
        stack: adapter.stack,
        environment: adapter.environment,
        uncoveredConnectors: uncovered,
        severity: "WARNING",
      });
    }
  }

  const coveredConnectors = Array.from(bundleConnectors);
  const uncoveredConnectors = Array.from(new Set(gaps.flatMap((g) => g.uncoveredConnectors)));

  return {
    compatible: gaps.length === 0,
    adapterCount: adapters.length,
    coveredConnectors,
    uncoveredConnectors,
    gaps,
  };
}

export function searchRuntimeDecisionEvidence(params: {
  evidence: RuntimeDecisionEvidenceRecord[];
  query: RuntimeEvidenceSearchQuery;
}): RuntimeEvidenceSearchResult {
  const { evidence, query } = params;
  let results = [...evidence];

  if (query.text) {
    const text = query.text.toLowerCase();
    results = results.filter(
      (r) =>
        r.agentId.toLowerCase().includes(text) ||
        r.reason.toLowerCase().includes(text) ||
        r.artifactHash.toLowerCase().includes(text) ||
        (r.triggerKind?.toLowerCase().includes(text) ?? false) ||
        (r.layer?.toLowerCase().includes(text) ?? false) ||
        (r.runtimeTarget.sandboxName?.toLowerCase().includes(text) ?? false) ||
        (r.runtimeTarget.inferenceProvider?.toLowerCase().includes(text) ?? false) ||
        (r.orchestratorRef?.companyId?.toLowerCase().includes(text) ?? false) ||
        (r.trustLevel?.toLowerCase().includes(text) ?? false) ||
        (r.pluginSource?.toLowerCase().includes(text) ?? false) ||
        (r.skillContext?.activeSkills.some((skill) => skill.toLowerCase().includes(text)) ??
          false) ||
        (r.catalogProvider?.toLowerCase().includes(text) ?? false),
    );
  }

  if (query.statuses?.length) {
    results = results.filter((r) => query.statuses!.includes(r.status));
  }

  if (query.runtimeStacks?.length) {
    results = results.filter((r) => query.runtimeStacks!.includes(r.runtimeTarget.stack));
  }

  if (query.connectors?.length) {
    results = results.filter((r) => query.connectors!.includes(r.connector));
  }

  if (query.triggerKinds?.length) {
    results = results.filter(
      (r) => r.triggerKind !== undefined && query.triggerKinds!.includes(r.triggerKind),
    );
  }

  if (query.layers?.length) {
    results = results.filter((r) => r.layer !== undefined && query.layers!.includes(r.layer));
  }

  if (query.sandboxNames?.length) {
    results = results.filter(
      (r) =>
        r.runtimeTarget.sandboxName !== undefined &&
        query.sandboxNames!.includes(r.runtimeTarget.sandboxName),
    );
  }

  if (query.inferenceProviders?.length) {
    results = results.filter(
      (r) =>
        r.runtimeTarget.inferenceProvider !== undefined &&
        query.inferenceProviders!.includes(r.runtimeTarget.inferenceProvider),
    );
  }

  if (query.trustLevels?.length) {
    results = results.filter(
      (r) => r.trustLevel !== undefined && query.trustLevels!.includes(r.trustLevel),
    );
  }

  if (query.pluginSources?.length) {
    results = results.filter(
      (r) => r.pluginSource !== undefined && query.pluginSources!.includes(r.pluginSource),
    );
  }

  if (query.skillIds?.length) {
    results = results.filter(
      (r) => r.skillContext?.activeSkills.some((skill) => query.skillIds!.includes(skill)) ?? false,
    );
  }

  if (query.companyIds?.length) {
    results = results.filter(
      (r) =>
        r.orchestratorRef?.companyId !== undefined &&
        query.companyIds!.includes(r.orchestratorRef.companyId),
    );
  }

  if (query.branchId) {
    results = results.filter((r) => r.policyContext.some((c) => c.branchId === query.branchId));
  }

  if (query.revisionId) {
    results = results.filter((r) => r.policyContext.some((c) => c.revisionId === query.revisionId));
  }

  if (query.from) {
    const fromTime = new Date(query.from).getTime();
    results = results.filter((r) => new Date(r.createdAt).getTime() >= fromTime);
  }

  if (query.to) {
    const toTime = new Date(query.to).getTime();
    results = results.filter((r) => new Date(r.createdAt).getTime() <= toTime);
  }

  const totalCount = evidence.length;
  const returnedCount = results.length;
  const deniedCount = results.filter((r) => r.status === "DENY").length;
  const warnedCount = results.filter((r) => r.status === "WARN").length;
  const allowedCount = results.filter((r) => r.status === "ALLOW").length;
  const policyRefCount = results.reduce((acc, r) => acc + r.policyRefs.length, 0);

  if (query.limit) {
    results = results.slice(0, query.limit);
  }

  return {
    query,
    results,
    totalCount,
    returnedCount,
    deniedCount,
    warnedCount,
    allowedCount,
    policyRefCount,
  };
}

export function buildComplianceFrameworkAnnotation(params: {
  framework: ComplianceFramework;
  approvalCount: number;
  evidenceCount: number;
  deniedDecisionCount: number;
  warnedDecisionCount: number;
  escalationCount: number;
  resolvedEscalationCount: number;
  artifactHash: string;
  operationsEventCounts: Record<string, number>;
  generatedAt: string;
}): ComplianceFrameworkAnnotation {
  const {
    approvalCount,
    evidenceCount,
    deniedDecisionCount,
    escalationCount,
    resolvedEscalationCount,
    operationsEventCounts,
  } = params;

  const evCount = (type: string) => operationsEventCounts[type] ?? 0;

  let frameworkLabel: string;
  let controls: ComplianceControl[];

  if (params.framework === "soc2") {
    frameworkLabel = "SOC 2 Type II (Trust Services Criteria)";
    controls = [
      {
        controlId: "CC6.1",
        controlName: "Logical and physical access controls",
        status:
          evCount("TOKEN_ISSUED") > 0 || evCount("IDENTITY_CHANGE") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evCount("TOKEN_ISSUED")} token issuance events`,
          `${evCount("TOKEN_REVOKED")} token revocation events`,
          `${evCount("IDENTITY_CHANGE")} identity lifecycle events`,
        ],
      },
      {
        controlId: "CC6.2",
        controlName: "User registration and de-provisioning",
        status: evCount("IDENTITY_CHANGE") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evCount("IDENTITY_CHANGE")} identity change events recorded in tamper-evident operations log`,
        ],
      },
      {
        controlId: "CC6.6",
        controlName: "Unauthorized or malicious access prevention",
        status: deniedDecisionCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${deniedDecisionCount} DENY decisions enforced by policy engine`,
          `${params.warnedDecisionCount} WARN decisions flagged for review`,
        ],
      },
      {
        controlId: "CC7.2",
        controlName: "System change management controls",
        status: approvalCount > 0 && evCount("POLICY_PUBLISH") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${approvalCount} policy approvals on record`,
          `${evCount("POLICY_PUBLISH")} policy publish events`,
          `${evCount("POLICY_IMPORT")} policy import events`,
        ],
      },
      {
        controlId: "CC4.1",
        controlName: "Continuous monitoring of controls",
        status:
          evidenceCount > 0 && evCount("VERIFICATION_RUN") > 0
            ? "ADDRESSED"
            : evidenceCount > 0
              ? "PARTIAL"
              : "NOT_APPLICABLE",
        evidence: [
          `${evidenceCount} runtime evidence records`,
          `${evCount("VERIFICATION_RUN")} AGT verification runs`,
        ],
      },
      {
        controlId: "CC7.3",
        controlName: "Evaluation of security incidents",
        status: escalationCount > 0 ? "ADDRESSED" : "NOT_APPLICABLE",
        evidence: [
          `${escalationCount} escalations raised`,
          `${resolvedEscalationCount} escalations resolved with documented outcomes`,
        ],
      },
    ];
  } else if (params.framework === "eu-ai-act") {
    frameworkLabel = "EU AI Act (Regulation 2024/1689)";
    controls = [
      {
        controlId: "Art.9",
        controlName: "Risk management system",
        status: escalationCount > 0 || deniedDecisionCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${escalationCount} escalation events — high-consequence actions flagged for human review`,
          `${deniedDecisionCount} denied decisions — policy engine blocking prohibited actions`,
        ],
      },
      {
        controlId: "Art.13",
        controlName: "Transparency and provision of information",
        status: evidenceCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evidenceCount} runtime evidence records with full policy reference chains`,
          `Compliance packet with artifact hash ${params.artifactHash.slice(0, 16)}`,
        ],
      },
      {
        controlId: "Art.14",
        controlName: "Human oversight",
        status:
          resolvedEscalationCount > 0
            ? "ADDRESSED"
            : escalationCount > 0
              ? "PARTIAL"
              : "NOT_APPLICABLE",
        evidence: [
          `${resolvedEscalationCount} escalations resolved by human reviewers with documented outcomes`,
          `${escalationCount - resolvedEscalationCount} escalations pending review`,
        ],
      },
      {
        controlId: "Art.17",
        controlName: "Quality management system",
        status: approvalCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${approvalCount} policy revisions with documented approver identity`,
          `${evCount("POLICY_PUBLISH")} publish events with immutable artifact hashes`,
        ],
      },
      {
        controlId: "Art.26",
        controlName: "Obligations of deployers — audit records",
        status: evCount("COMPLIANCE_EXPORT") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evCount("COMPLIANCE_EXPORT")} compliance export and seal events in operations log`,
          "Hash-chained tamper-evident audit trail maintained",
        ],
      },
    ];
  } else if (params.framework === "hipaa") {
    frameworkLabel = "HIPAA Security Rule (45 CFR Part 164)";
    controls = [
      {
        controlId: "§164.312(b)",
        controlName: "Audit controls",
        status: evCount("EVIDENCE_INGEST") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evCount("EVIDENCE_INGEST")} evidence ingest events in tamper-evident operations log`,
          `Hash-chained audit chain with ${evCount("EVIDENCE_INGEST") + evCount("POLICY_PUBLISH") + evCount("IDENTITY_CHANGE")} total controlled events`,
        ],
      },
      {
        controlId: "§164.312(a)(1)",
        controlName: "Access control",
        status: evCount("TOKEN_ISSUED") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evCount("TOKEN_ISSUED")} token issuance events — each agent access provisioned with scoped credentials`,
          `${evCount("TOKEN_REVOKED")} token revocation events`,
        ],
      },
      {
        controlId: "§164.308(a)(1)",
        controlName: "Security management process — risk analysis",
        status:
          deniedDecisionCount > 0 && escalationCount > 0
            ? "ADDRESSED"
            : deniedDecisionCount > 0
              ? "PARTIAL"
              : "NOT_APPLICABLE",
        evidence: [
          `${deniedDecisionCount} DENY decisions — policy engine enforcing access restrictions`,
          `${escalationCount} escalations raised for high-risk or restricted data sensitivity actions`,
        ],
      },
      {
        controlId: "§164.312(e)(1)",
        controlName: "Transmission security",
        status: "ADDRESSED",
        evidence: [
          `Policy artifacts exported with SHA-256 artifact hash ${params.artifactHash.slice(0, 16)}`,
          "AGT-compatible signed bundle format used for all runtime distribution",
        ],
      },
      {
        controlId: "§164.308(a)(3)",
        controlName: "Workforce security — authorization and supervision",
        status: approvalCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${approvalCount} policy approvals — reviewer identity captured on each approval`,
          `${evCount("IDENTITY_CHANGE")} identity lifecycle events recorded`,
        ],
      },
    ];
  } else {
    const frameworkLabels: Record<
      Exclude<ComplianceFramework, "soc2" | "eu-ai-act" | "hipaa">,
      string
    > = {
      iso27001: "ISO/IEC 27001:2022",
      gdpr: "GDPR accountability and security controls",
      "pci-dss": "PCI DSS v4.0",
      "nist-ai-rmf": "NIST AI RMF 1.0",
      "public-sector": "Public-sector AI and security review",
    };
    frameworkLabel = frameworkLabels[params.framework];
    controls = [
      {
        controlId:
          params.framework === "iso27001"
            ? "A.5.1/A.8.15"
            : params.framework === "gdpr"
              ? "Art.5(2)/Art.32"
              : params.framework === "pci-dss"
                ? "Req.10"
                : params.framework === "nist-ai-rmf"
                  ? "MAP-5/GOV-4"
                  : "Auditability",
        controlName: "Tamper-evident auditability and accountability",
        status: evidenceCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evidenceCount} runtime evidence records with policy context`,
          `${evCount("EVIDENCE_INGEST")} evidence ingest events in the operations log`,
          `Compliance packet artifact hash ${params.artifactHash.slice(0, 16)}`,
        ],
      },
      {
        controlId:
          params.framework === "iso27001"
            ? "A.5.15/A.5.18"
            : params.framework === "gdpr"
              ? "Art.25/Art.32"
              : params.framework === "pci-dss"
                ? "Req.7/Req.8"
                : params.framework === "nist-ai-rmf"
                  ? "GOV-1/MANAGE-2"
                  : "Access control",
        controlName: "Access control and credential lifecycle",
        status:
          evCount("TOKEN_ISSUED") > 0 || evCount("IDENTITY_CHANGE") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${evCount("TOKEN_ISSUED")} token issuance events`,
          `${evCount("TOKEN_REVOKED")} token revocation events`,
          `${evCount("IDENTITY_CHANGE")} identity lifecycle events`,
        ],
      },
      {
        controlId:
          params.framework === "iso27001"
            ? "A.8.8/A.8.9"
            : params.framework === "gdpr"
              ? "Art.35"
              : params.framework === "pci-dss"
                ? "Req.12"
                : params.framework === "nist-ai-rmf"
                  ? "MEASURE-2/MANAGE-4"
                  : "Risk review",
        controlName: "Policy risk management and human review",
        status: deniedDecisionCount > 0 || escalationCount > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${deniedDecisionCount} denied decisions`,
          `${params.warnedDecisionCount} warned decisions`,
          `${resolvedEscalationCount} of ${escalationCount} escalations resolved`,
        ],
      },
      {
        controlId:
          params.framework === "iso27001"
            ? "A.5.37/A.8.32"
            : params.framework === "gdpr"
              ? "Art.24"
              : params.framework === "pci-dss"
                ? "Req.6"
                : params.framework === "nist-ai-rmf"
                  ? "GOV-3"
                  : "Change governance",
        controlName: "Controlled policy change management",
        status: approvalCount > 0 && evCount("POLICY_PUBLISH") > 0 ? "ADDRESSED" : "PARTIAL",
        evidence: [
          `${approvalCount} policy approvals`,
          `${evCount("POLICY_IMPORT")} policy import events`,
          `${evCount("POLICY_PUBLISH")} policy publish events`,
        ],
      },
    ];
  }

  const addressedCount = controls.filter((c) => c.status === "ADDRESSED").length;
  const partialCount = controls.filter((c) => c.status === "PARTIAL").length;
  const notApplicableCount = controls.filter((c) => c.status === "NOT_APPLICABLE").length;

  return {
    framework: params.framework,
    frameworkLabel,
    generatedAt: params.generatedAt,
    controls,
    summary: { addressedCount, partialCount, notApplicableCount },
  };
}
