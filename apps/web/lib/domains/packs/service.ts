import { logger } from "@spctre/platform/logging";
import { createHash } from "crypto";
import {
  applyPackParameterOverrides,
  buildPolicyImportResult,
  getPackMetadata,
  packToDocument,
  parseAgtPolicyDocument,
  POLICY_PACKS,
} from "@spctre/policy-schema";
import type {
  PolicyImportResult,
  PolicyRuleSummary,
  PolicyPackParameterDefinition,
} from "@spctre/policy-schema";
import { getActiveActor, requireActorAdminWorkspace } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { runWithTenantContext } from "@/lib/tenant-context";
import {
  findConnectorBranch,
  listAdapterDeclarations,
  listPackInstallStatuses,
  listRulesForRevision,
  listRulesForRevisions,
  persistPackInstallBranch,
  persistPackUpgradeRevision,
  upsertAdapterDeclaration,
} from "@/lib/repositories/packs";
import {
  insertAuthorizationDenialEvent,
  resolveWorkspaceForAction,
} from "@/lib/repositories/workspace";
import { listObservedConnectorActions } from "@/lib/repositories/evidence/runtime";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import { insertPolicyPublish } from "@/lib/repositories/policy/publish";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import { workspaceAllowsImmediatePackPublish } from "@/lib/repositories/approval-workflow/config";
import { swallow } from "@/lib/platform/swallow";

export interface PackUpgradeSummary {
  addedFromUpstream: number;
  removedFromUpstream: number;
  modifiedFromUpstream: number;
  localOnlyRules: number;
}

// Deterministic, key-sorted stringify so object key order never affects equality.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

// Excluded from equivalence: document-location metadata (sourceFormat/sourcePath
// vary by source path, not rule content) and originalRule — the one true derived
// duplicate (the parser stores the entire raw rule there, so comparing it would
// double-count and false-positive on serialization differences). preservedFields
// is NOT excluded: the parser stores unknown AGT-native rule properties there, so
// a rule customized only through a preserved field must count as different or the
// upgrade would silently drop that customization (it is canonicalized like any
// other nested value by canonicalRuleContent).
const EQUIVALENCE_EXCLUDED_FIELDS = new Set(["sourceFormat", "sourcePath", "originalRule"]);

function canonicalRuleContent(rule: PolicyRuleSummary): string {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    if (!EQUIVALENCE_EXCLUDED_FIELDS.has(key) && value !== undefined) content[key] = value;
  }
  return stableStringify(JSON.parse(JSON.stringify(content)));
}

// Two rules are equivalent only when their COMPLETE content matches. Comparing a
// hand-picked subset (as an earlier version did) meant a local edit to a
// semantic check, control mapping, or any unmodeled field was seen as identical
// to upstream and silently replaced on pack upgrade — the opposite of the
// preserve-customizations contract.
export function areRulesEquivalent(left: PolicyRuleSummary, right: PolicyRuleSummary): boolean {
  return canonicalRuleContent(left) === canonicalRuleContent(right);
}

// Regenerates the persisted source document/string from the actual rules
// being written to the DB (post-merge, post-override) — never from the
// original pack defaults. The source_hash and source_document are the audit
// trail; if they're built from unmodified pack defaults while `rules` carries
// an applied override, the hash and stored document silently disagree with
// what's actually enforced. Includes semanticChecks/parameterConstraints/
// controlMappings so the hash actually changes when an override changes what
// gets enforced, not just the six structural fields.
export function buildRuleSourceDocument(
  rules: PolicyRuleSummary[],
  baseSourceDocument?: Record<string, unknown>,
): { sourceDocument: Record<string, unknown>; source: string } {
  const sourceDocument = {
    ...(baseSourceDocument ?? {}),
    rules: rules.map((rule) => {
      // Preserve every field, including unmodeled/AGT-native ones, so a retained
      // customization is not silently dropped when the source document is
      // rebuilt. Only document-location metadata (sourceFormat/sourcePath) and
      // the derived raw duplicate (originalRule — re-derived on parse, and would
      // nest on every upgrade) are omitted.
      const {
        stableRuleId,
        sourceFormat: _sourceFormat,
        sourcePath: _sourcePath,
        originalRule: _originalRule,
        preservedFields,
        semanticChecks,
        parameterConstraints,
        controlMappings,
        ...rest
      } = rule;
      return {
        ...(preservedFields ?? {}),
        ...rest,
        stable_rule_id: stableRuleId,
        ...(semanticChecks ? { semantic_checks: semanticChecks } : {}),
        ...(parameterConstraints ? { parameter_constraints: parameterConstraints } : {}),
        ...(controlMappings ? { control_mappings: controlMappings } : {}),
      };
    }),
  };
  return { sourceDocument, source: JSON.stringify(sourceDocument, null, 2) };
}

function buildUpgradeSummary(
  installedRules: PolicyRuleSummary[],
  packRules: PolicyRuleSummary[],
): PackUpgradeSummary {
  const installedById = new Map(installedRules.map((rule) => [rule.stableRuleId, rule]));
  const packById = new Map(packRules.map((rule) => [rule.stableRuleId, rule]));

  let addedFromUpstream = 0;
  let removedFromUpstream = 0;
  let modifiedFromUpstream = 0;
  let localOnlyRules = 0;

  for (const packRule of packRules) {
    const installedRule = installedById.get(packRule.stableRuleId);
    if (!installedRule) {
      addedFromUpstream += 1;
      continue;
    }
    if (!areRulesEquivalent(installedRule, packRule)) {
      modifiedFromUpstream += 1;
    }
  }

  for (const installedRule of installedRules) {
    if (!packById.has(installedRule.stableRuleId)) {
      localOnlyRules += 1;
      removedFromUpstream += 1;
    }
  }

  return { addedFromUpstream, removedFromUpstream, modifiedFromUpstream, localOnlyRules };
}

export async function getPacksCatalogModel(params: {
  workspaceId: string;
  tenantId: string;
}): Promise<{
  installedByConnector: Record<
    string,
    {
      branchId: string;
      revisionId: string;
      installedVersion: string;
      installedAt: string;
      hasCustomizations: boolean;
    }
  >;
  upgradeSummaryByConnector: Record<string, PackUpgradeSummary>;
}> {
  const { statuses, installedRulesByConnector } = await runWithTenantContext(
    params.tenantId,
    async () => {
      const statuses = await listPackInstallStatuses(params.workspaceId, params.tenantId);
      // One batched query for every installed pack's rules instead of one per pack.
      // See database-optimizations-audit (Minor).
      const rulesByRevision = await listRulesForRevisions({
        revisionIds: statuses.map((status) => status.revisionId),
        tenantId: params.tenantId,
      }).catch(swallow("listRulesForRevisions", new Map<string, PolicyRuleSummary[]>()));
      const installedRulesByConnector = Object.fromEntries(
        statuses.map((status) => [status.connector, rulesByRevision.get(status.revisionId) ?? []]),
      ) as Record<string, PolicyRuleSummary[]>;
      return { statuses, installedRulesByConnector };
    },
  );

  const installedByConnector = Object.fromEntries(
    statuses.map((status) => [
      status.connector,
      {
        branchId: status.branchId,
        revisionId: status.revisionId,
        installedVersion: status.installedVersion,
        installedAt: status.installedAt,
        hasCustomizations: status.hasCustomizations,
      },
    ]),
  );

  const upgradeSummaryByConnector = Object.fromEntries(
    POLICY_PACKS.map((pack) => {
      const installedRules = installedRulesByConnector[pack.connector];
      const packRules: PolicyRuleSummary[] = pack.rules.map((rule) => ({
        ...rule,
        sourceFormat: "AGT_YAML",
      }));
      const summary = installedRules ? buildUpgradeSummary(installedRules, packRules) : undefined;
      return [pack.connector, summary];
    }).filter((entry): entry is [string, PackUpgradeSummary] => Boolean(entry[1])),
  );

  return { installedByConnector, upgradeSummaryByConnector };
}

/**
 * Typed connector/action vocabulary for the schema-aware rule builder, drawn
 * from installed packs. Suggestions only — the authoring UI keeps every field
 * free-text so policy-as-code users retain a lossless escape hatch.
 */
export interface AuthoringVocabularyEntry {
  connector: string;
  domains: string[];
  actions: string[];
  parameters: PolicyPackParameterDefinition[];
  /** Tool-parameter dot-paths seen in this pack's rule constraints. */
  constraintFields: string[];
}

// Platform and onboarding connectors are not customer runtime integrations.
// Exclude them and their actions from normal rule-authoring suggestions.
const HIDDEN_AUTHORING_CONNECTORS = new Set(["sample", "spctre-agent"]);

function isHiddenAuthoringConnector(connector: string): boolean {
  return HIDDEN_AUTHORING_CONNECTORS.has(connector.trim().toLowerCase());
}

function uniqueSorted(values: readonly (string | undefined | null)[]): string[] {
  return Array.from(new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))).sort();
}

// Pure: map a set of installed connector names to the vocabulary carried by the
// canonical pack definitions. Multiple packs on one connector are merged.
export function buildAuthoringVocabulary(
  installedConnectors: readonly string[],
): AuthoringVocabularyEntry[] {
  const installed = new Set(installedConnectors);
  const byConnector = new Map<
    string,
    {
      domains: string[];
      actions: string[];
      parameters: PolicyPackParameterDefinition[];
      constraintFields: string[];
    }
  >();

  for (const pack of POLICY_PACKS) {
    if (isHiddenAuthoringConnector(pack.connector)) continue;
    if (!installed.has(pack.connector)) continue;
    const entry = byConnector.get(pack.connector) ?? {
      domains: [],
      actions: [],
      parameters: [],
      constraintFields: [],
    };
    entry.domains.push(...pack.domains);
    entry.actions.push(...pack.rules.flatMap((rule) => rule.actions ?? []));
    entry.parameters.push(...(pack.parameters ?? []));
    entry.constraintFields.push(
      ...pack.rules.flatMap((rule) =>
        (rule.parameterConstraints ?? []).map((constraint) => constraint.field),
      ),
    );
    byConnector.set(pack.connector, entry);
  }

  return Array.from(byConnector.entries())
    .map(([connector, entry]) => {
      // Dedupe parameter knobs by key, preserving first definition.
      const parametersByKey = new Map<string, PolicyPackParameterDefinition>();
      for (const parameter of entry.parameters) {
        if (!parametersByKey.has(parameter.key)) parametersByKey.set(parameter.key, parameter);
      }
      return {
        connector,
        domains: uniqueSorted(entry.domains),
        actions: uniqueSorted(entry.actions),
        parameters: Array.from(parametersByKey.values()),
        constraintFields: uniqueSorted(entry.constraintFields),
      };
    })
    .sort((left, right) => left.connector.localeCompare(right.connector));
}

// Fold connector/action pairs observed in evidence into the pack vocabulary:
// extend a known connector's actions, or add a bare entry for a connector no
// installed pack covers. Suggestions only — sources are intentionally merged.
export function mergeObservedVocabulary(
  packVocab: AuthoringVocabularyEntry[],
  observed: readonly { connector: string; action: string }[],
): AuthoringVocabularyEntry[] {
  const byConnector = new Map(
    packVocab
      .filter((entry) => !isHiddenAuthoringConnector(entry.connector))
      .map((entry) => [entry.connector, { ...entry, actions: [...entry.actions] }]),
  );

  for (const { connector, action } of observed) {
    const key = connector.trim();
    const value = action.trim();
    if (!key || isHiddenAuthoringConnector(key)) continue;
    const entry = byConnector.get(key) ?? {
      connector: key,
      domains: [],
      actions: [],
      parameters: [],
      constraintFields: [],
    };
    if (value) entry.actions = uniqueSorted([...entry.actions, value]);
    byConnector.set(key, entry);
  }

  return Array.from(byConnector.values()).sort((left, right) =>
    left.connector.localeCompare(right.connector),
  );
}

export async function getAuthoringVocabulary(params: {
  workspaceId: string;
  tenantId: string;
}): Promise<AuthoringVocabularyEntry[]> {
  const [statuses, observed] = await runWithTenantContext(params.tenantId, () =>
    Promise.all([
      listPackInstallStatuses(params.workspaceId, params.tenantId).catch(
        swallow("listPackInstallStatuses", []),
      ),
      listObservedConnectorActions(params.workspaceId, params.tenantId).catch(
        swallow("listObservedConnectorActions", []),
      ),
    ]),
  ).catch(swallow("runWithTenantContext", [[], []] as const));

  const packVocab = buildAuthoringVocabulary(statuses.map((status) => status.connector));
  return mergeObservedVocabulary(packVocab, observed);
}

export async function listAdapterDeclarationsForWorkspace(params: {
  workspaceId: string;
  tenantId: string;
  environment?: string;
}) {
  return listAdapterDeclarations(params.workspaceId, params.tenantId, params.environment);
}

export async function upsertAdapterDeclarationForWorkspace(
  declaration: Parameters<typeof upsertAdapterDeclaration>[0],
  params: { workspaceId: string; tenantId: string },
) {
  return upsertAdapterDeclaration(declaration, params.workspaceId, params.tenantId);
}

function mergePackRulesWithCustomizations(params: {
  upstreamRules: PolicyRuleSummary[];
  activeRules: PolicyRuleSummary[];
  preserveCustomizations: boolean;
}): PolicyRuleSummary[] {
  if (!params.preserveCustomizations) {
    return params.upstreamRules;
  }

  const upstreamById = new Map(params.upstreamRules.map((rule) => [rule.stableRuleId, rule]));
  const activeById = new Map(params.activeRules.map((rule) => [rule.stableRuleId, rule]));

  const merged: PolicyRuleSummary[] = [];

  for (const upstreamRule of params.upstreamRules) {
    const activeRule = activeById.get(upstreamRule.stableRuleId);
    if (activeRule && !areRulesEquivalent(activeRule, upstreamRule)) {
      merged.push(activeRule);
      continue;
    }
    merged.push(upstreamRule);
  }

  for (const activeRule of params.activeRules) {
    if (!upstreamById.has(activeRule.stableRuleId)) {
      merged.push(activeRule);
    }
  }

  return merged;
}

export type ImportPolicyPackResult =
  { result: PolicyImportResult; workspaceSlug?: string } | { error: string };

interface PersistedPackRevision {
  branchId: string;
  revisionId: string;
  sourceHash: string;
  importedAt: string;
  persistedRules: PolicyRuleSummary[];
}

// Upgrade path: merge upstream rules with local customizations and persist a
// new revision on the existing connector branch.
async function persistPackUpgrade(args: {
  tenantId: string;
  actorId: string;
  workspaceId: string;
  connectorBranch: { id: string; active_revision_id: string | null };
  pack: (typeof POLICY_PACKS)[number];
  packMetadata: ReturnType<typeof getPackMetadata>;
  parsed: ReturnType<typeof parseAgtPolicyDocument>;
  sourcePath: string;
  metadata: Record<string, unknown>;
  preserveCustomizations: boolean;
  parameterOverrides?: Record<string, unknown>;
}): Promise<PersistedPackRevision> {
  const { connectorBranch, pack, packMetadata, parsed } = args;
  const activeRules = await listRulesForRevision({
    tenantId: args.tenantId,
    revisionId: connectorBranch.active_revision_id,
  });

  const mergedRules = mergePackRulesWithCustomizations({
    upstreamRules: parsed.rules,
    activeRules,
    preserveCustomizations: args.preserveCustomizations,
  });
  // Applied after the merge so an explicit override on this call always wins,
  // whether the merge picked upstream or a preserved local customization.
  const rulesWithOverrides = args.parameterOverrides
    ? applyPackParameterOverrides(mergedRules, args.parameterOverrides)
    : mergedRules;

  const { sourceDocument: mergedSourceDocument, source: mergedSource } = buildRuleSourceDocument(
    rulesWithOverrides,
    parsed.sourceDocument,
  );

  const persisted = await persistPackUpgradeRevision({
    tenantId: args.tenantId,
    authorId: args.actorId,
    workspaceId: args.workspaceId,
    branchId: connectorBranch.id,
    parentRevisionId: connectorBranch.active_revision_id ?? undefined,
    sourcePath: args.sourcePath,
    source: mergedSource,
    rules: rulesWithOverrides,
    metadata: args.metadata,
    sourceDocument: mergedSourceDocument,
    compatibility: parsed.compatibility,
    message: args.preserveCustomizations
      ? `Upgrade ${pack.name} to v${packMetadata.version} (preserve local customizations)`
      : `Upgrade ${pack.name} to v${packMetadata.version} (reset to upstream defaults)`,
  });

  return {
    branchId: connectorBranch.id,
    revisionId: persisted.revisionId,
    sourceHash: persisted.sourceHash,
    importedAt: persisted.importedAt,
    persistedRules: rulesWithOverrides,
  };
}

// Publish the imported revision right away when the workspace allows it.
// Returns an error message when publish is not permitted.
async function publishPackImmediately(args: {
  tenantId: string;
  workspaceId: string;
  branchId: string;
  revisionId: string;
  actorId: string;
}): Promise<string | null> {
  const allowed = await workspaceAllowsImmediatePackPublish({
    tenantId: args.tenantId,
    workspaceId: args.workspaceId,
  });
  if (!allowed) {
    return "Immediate pack publish is not enabled for this workspace.";
  }

  const artifactHash = `sha256:${createHash("sha256")
    .update(`${args.revisionId}-${Date.now()}`)
    .digest("hex")
    .slice(0, 16)}`;

  await insertPolicyPublish({
    tenantId: args.tenantId,
    branchId: args.branchId,
    revisionId: args.revisionId,
    artifactHash,
    actorId: args.actorId,
  });

  await appendOperationsLog({
    tenantId: args.tenantId,
    workspaceId: args.workspaceId,
    eventType: "POLICY_PUBLISH",
    sourceId: args.revisionId,
    sourceTable: "policy_publish",
    actorId: args.actorId,
    payload: { branchId: args.branchId, revisionId: args.revisionId, artifactHash },
  }).catch(swallow("appendOperationsLog", undefined));

  return null;
}

function buildPackProvenanceMetadata(
  pack: (typeof POLICY_PACKS)[number],
  packMetadata: ReturnType<typeof getPackMetadata>,
  input: {
    mode: string;
    preserveCustomizations: boolean;
    parameterOverrides?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return {
    ...pack.metadata,
    // persistPackInstallBranch/persistPackUpgradeRevision replace the
    // persisted revision's source_document.metadata wholesale with this
    // object (see apps/web/lib/repositories/packs.ts) rather than merging —
    // so the pack's parameter catalog must be carried here, or a later
    // UI/API has no way to discover labels/types/defaults/enum choices for
    // an installed pack, even though overrides still enforce correctly.
    ...(pack.parameters ? { parameters: pack.parameters } : {}),
    spctre_pack: {
      packId: pack.id,
      connector: pack.connector,
      version: packMetadata.version,
      owner: packMetadata.owner,
      reviewRoles: packMetadata.reviewRoles,
      minimumApprovals: packMetadata.minimumApprovals,
      compatibilityTargets: packMetadata.compatibilityTargets,
      importedVia: input.mode,
      preserveCustomizations: input.mode === "upgrade" ? input.preserveCustomizations : undefined,
      parameterOverrides: input.parameterOverrides,
    },
  };
}

export async function importPolicyPackDecision(input: {
  packId: string;
  mode: string;
  preserveCustomizations: boolean;
  requestedWorkspaceId: string;
  immediatelyPublish?: boolean;
  /**
   * Workspace overrides for this pack's parameters, keyed by
   * PolicyPackParameterDefinition.key / PolicyParameterConstraint.parameterKey
   * (e.g. "stripe.refund_review_threshold_cents"). Applied on top of the
   * merged rule set so an explicit override always wins; carried forward on
   * later upgrades via preserveCustomizations since the overridden value is
   * baked into the persisted rule and areRulesEquivalent compares it.
   */
  parameterOverrides?: Record<string, unknown>;
}): Promise<ImportPolicyPackResult> {
  if (input.mode !== "install" && input.mode !== "upgrade") {
    return { error: "Invalid mode. Expected install or upgrade." };
  }

  const pack = POLICY_PACKS.find((p) => p.id === input.packId);
  if (!pack) return { error: "Policy pack not found." };

  const packMetadata = getPackMetadata(pack);
  const metadataWithPackProvenance = buildPackProvenanceMetadata(pack, packMetadata, input);

  const source = packToDocument(pack);
  const sourcePath = `packs/${pack.id}.json`;
  const branchName = pack.connector;
  const parsed = parseAgtPolicyDocument({ document: source, sourcePath });
  const parsedRulesWithOverrides = input.parameterOverrides
    ? applyPackParameterOverrides(parsed.rules, input.parameterOverrides)
    : parsed.rules;
  // The persisted source/sourceDocument (and the hash derived from it) must
  // reflect what's actually enforced. Regenerate them from the overridden
  // rules rather than reusing the unmodified pack-default source — otherwise
  // the audit trail says one threshold while the rule rows enforce another.
  const { sourceDocument: installSourceDocument, source: installSource } = input.parameterOverrides
    ? buildRuleSourceDocument(parsedRulesWithOverrides, parsed.sourceDocument)
    : { sourceDocument: parsed.sourceDocument ?? {}, source };

  if (!isDatabaseConfigured()) {
    return {
      result: buildPolicyImportResult({
        id: crypto.randomUUID(),
        branchId: `br-${branchName}`,
        revisionId: crypto.randomUUID(),
        sourceFormat: "AGT_YAML",
        sourcePath,
        sourceHash: `sha256:${createHash("sha256").update(installSource).digest("hex").slice(0, 16)}`,
        author: "system",
        importedAt: new Date().toISOString(),
        rules: parsedRulesWithOverrides,
        warnings: [],
        diagnostics: [],
        metadata: metadataWithPackProvenance,
      }),
    };
  }

  try {
    const workspaceContext = await getWorkspaceContext();
    const tenantId = workspaceContext.tenantId;
    const targetWorkspace = await resolveWorkspaceForAction({
      tenantId,
      requestedWorkspaceId: input.requestedWorkspaceId,
      fallbackWorkspaceId: workspaceContext.workspaceId,
    });
    if (!targetWorkspace) return { error: "Workspace not found." };

    const { actor } = await getActiveActor({ workspaceId: targetWorkspace.id, tenantId });
    const adminCheck = requireActorAdminWorkspace(actor, targetWorkspace.slug);
    if (!adminCheck.allowed) {
      await insertAuthorizationDenialEvent({
        tenantId,
        action: input.mode === "upgrade" ? "policy_pack.upgrade" : "policy_pack.import",
        reason: adminCheck.reason,
        resourceType: "workspace",
        resourceId: targetWorkspace.id,
        principalId: actor.id,
        workspaceId: targetWorkspace.id,
      });
      return { error: adminCheck.reason };
    }

    const connectorBranch = await findConnectorBranch({
      tenantId,
      workspaceId: targetWorkspace.id,
      connector: pack.connector,
    });

    if (input.mode === "install" && connectorBranch) {
      return { error: "This connector pack is already installed. Use upgrade instead." };
    }
    if (input.mode === "upgrade" && !connectorBranch) {
      return { error: "This connector pack is not installed yet. Install it first." };
    }

    let persisted: PersistedPackRevision;
    if (connectorBranch) {
      persisted = await persistPackUpgrade({
        tenantId,
        actorId: actor.id,
        workspaceId: targetWorkspace.id,
        connectorBranch,
        pack,
        packMetadata,
        parsed,
        sourcePath,
        metadata: metadataWithPackProvenance,
        preserveCustomizations: input.preserveCustomizations,
        parameterOverrides: input.parameterOverrides,
      });
    } else {
      const installed = await persistPackInstallBranch({
        tenantId,
        authorId: actor.id,
        branchName,
        workspaceId: targetWorkspace.id,
        connector: pack.connector,
        sourcePath,
        source: installSource,
        rules: parsedRulesWithOverrides,
        metadata: metadataWithPackProvenance,
        sourceDocument: installSourceDocument,
        compatibility: parsed.compatibility,
        message: `Install ${pack.name} v${packMetadata.version}`,
      });
      persisted = { ...installed, persistedRules: parsedRulesWithOverrides };
    }
    const { branchId, revisionId, sourceHash, importedAt, persistedRules } = persisted;

    if (input.immediatelyPublish) {
      const publishError = await publishPackImmediately({
        tenantId,
        workspaceId: targetWorkspace.id,
        branchId,
        revisionId,
        actorId: actor.id,
      });
      if (publishError) return { error: publishError };
    }

    return {
      workspaceSlug: workspaceContext.workspaceSlug,
      result: buildPolicyImportResult({
        id: crypto.randomUUID(),
        branchId,
        revisionId,
        sourceFormat: "AGT_YAML",
        sourcePath,
        sourceHash,
        author: actor.name,
        importedAt,
        rules: persistedRules,
        warnings: [],
        diagnostics: [],
        metadata: metadataWithPackProvenance,
      }),
    };
  } catch (error) {
    logger.error("[importPolicyPackDecision] database error:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "An unexpected error occurred. Please try again." };
  }
}
