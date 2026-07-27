import { createHash } from "crypto";
import { logger } from "@spctre/platform/logging";
import { getActiveActor, requireActorAdminWorkspace } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { arraysEqual } from "@/lib/collections";
import {
  getRevisionForDraft,
  createDraftRevision,
  getBranchForRollback,
  createCommittedRevision,
} from "@/lib/repositories/policy";
import { listRulesForRevision } from "@/lib/repositories/shared/rules";
import { insertAuthorizationDenialEvent } from "@/lib/repositories/workspace";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import { reservedStableRuleIdError } from "@/lib/policy/reserved-rule-ids";
import type { PolicyParameterConstraint, PolicyControlMapping } from "@spctre/policy-schema";

export type DraftRevisionState =
  | { revisionId: string; sourceHash: string; ruleCount: number; error?: never }
  | { error: string; revisionId?: never; sourceHash?: never; ruleCount?: never }
  | null;

export type CommitRevisionState =
  | { revisionId: string; sourceHash: string; ruleCount: number; error?: never }
  | { error: string; revisionId?: never; sourceHash?: never; ruleCount?: never }
  | null;

const VALID_RULE_EFFECTS = new Set(["ALLOW", "DENY", "WARN", "ESCALATE"]);
const CONSTRAINT_OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq", "neq", "in", "not_in", "contains"]);
const CONTROL_FRAMEWORKS = new Set(["SOC2", "HIPAA", "ISO_27001", "ISO_42001", "EU_AI_ACT", "NIST_AI_RMF", "OWASP_AGENTIC"]);

// Fields the in-app editor models explicitly. Any other key on an incoming rule
// (priority, conditions, dynamicConditions, preservedFields, originalRule, AGT-
// native fields, ...) is preserved verbatim so committing an edited revision
// never silently strips runtime- or provenance-critical rule data.
const MODELED_RULE_KEYS = new Set([
  "stableRuleId", "title", "effect", "domains", "connectors", "actions", "immutable",
  "semanticChecks", "semantic_checks",
  "parameterConstraints", "parameter_constraints",
  "controlMappings", "control_mappings",
]);

interface RuleAuthoringInput {
  stableRuleId: string;
  title: string;
  effect: "ALLOW" | "DENY" | "WARN" | "ESCALATE";
  domains: string[];
  connectors: string[];
  actions: string[];
  immutable: boolean;
  semanticChecks?: { id: string; prompt: string; effect?: "ALLOW" | "DENY" | "WARN" | "ESCALATE" }[];
  parameterConstraints?: PolicyParameterConstraint[];
  controlMappings?: PolicyControlMapping[];
  // Passthrough of unmodeled rule fields; kept for lossless round-trip.
  [key: string]: unknown;
}

function toParameterConstraints(value: unknown): PolicyParameterConstraint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item): PolicyParameterConstraint[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const field = String(row.field ?? "").trim();
    const operator = String(row.operator ?? "").trim();
    if (!field || !CONSTRAINT_OPERATORS.has(operator)) return [];
    const constraint: PolicyParameterConstraint = {
      field,
      operator: operator as PolicyParameterConstraint["operator"],
      value: row.value,
    };
    const parameterKey = String(row.parameterKey ?? row.parameter_key ?? "").trim();
    if (parameterKey) constraint.parameterKey = parameterKey;
    const rawEffect = String(row.effect ?? "").trim().toUpperCase();
    if (VALID_RULE_EFFECTS.has(rawEffect)) {
      constraint.effect = rawEffect as PolicyParameterConstraint["effect"];
    }
    return [constraint];
  });
  return items.length > 0 ? items : undefined;
}

function toControlMappings(value: unknown): PolicyControlMapping[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item): PolicyControlMapping[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const framework = String(row.framework ?? "").trim();
    const controlId = String(row.controlId ?? row.control_id ?? "").trim();
    if (!CONTROL_FRAMEWORKS.has(framework) || !controlId) return [];
    const mapping: PolicyControlMapping = { framework: framework as PolicyControlMapping["framework"], controlId };
    const rationale = String(row.rationale ?? "").trim();
    if (rationale) mapping.rationale = rationale;
    return [mapping];
  });
  return items.length > 0 ? items : undefined;
}

function normalizeRuleAuthoringInput(input: unknown): RuleAuthoringInput | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;

  const stableRuleId = String(row.stableRuleId ?? "").trim();
  const title = String(row.title ?? "").trim();
  const effect = String(row.effect ?? "").trim().toUpperCase();

  const toTextArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];

  const toSemanticChecksArray = (value: unknown): RuleAuthoringInput["semanticChecks"] => {
    if (!Array.isArray(value)) return undefined;
    const items = value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const itemObj = item as Record<string, unknown>;
        const prompt = String(itemObj.prompt ?? "").trim();
        const id = String(itemObj.id ?? "").trim();
        const rawEffect = String(itemObj.effect ?? "").trim().toUpperCase();
        const effect = VALID_RULE_EFFECTS.has(rawEffect) ? (rawEffect as "ALLOW" | "DENY" | "WARN") : undefined;
        if (!prompt || !id) return null;
        const check: { id: string; prompt: string; effect?: "ALLOW" | "DENY" | "WARN" } = { id, prompt };
        if (effect) {
          check.effect = effect;
        }
        return check;
      })
      .filter((item): item is { id: string; prompt: string; effect?: "ALLOW" | "DENY" | "WARN" } => item !== null);
    return items.length > 0 ? items : undefined;
  };

  if (!stableRuleId || !title || !VALID_RULE_EFFECTS.has(effect)) return null;

  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!MODELED_RULE_KEYS.has(key)) passthrough[key] = value;
  }

  return {
    ...passthrough,
    stableRuleId,
    title,
    effect: effect as RuleAuthoringInput["effect"],
    domains: toTextArray(row.domains),
    connectors: toTextArray(row.connectors),
    actions: toTextArray(row.actions),
    immutable: Boolean(row.immutable),
    semanticChecks: toSemanticChecksArray(row.semanticChecks ?? row.semantic_checks),
    parameterConstraints: toParameterConstraints(row.parameterConstraints ?? row.parameter_constraints),
    controlMappings: toControlMappings(row.controlMappings ?? row.control_mappings),
  };
}

function isSameRule(left: RuleAuthoringInput, right: RuleAuthoringInput): boolean {
  const leftChecks = left.semanticChecks ?? [];
  const rightChecks = right.semanticChecks ?? [];
  const checksEqual = leftChecks.length === rightChecks.length &&
    leftChecks.every((check, index) => {
      const rightCheck = rightChecks[index];
      return check.id === rightCheck.id && check.prompt === rightCheck.prompt && check.effect === rightCheck.effect;
    });

  return (
    left.title === right.title &&
    left.effect === right.effect &&
    left.immutable === right.immutable &&
    arraysEqual(left.domains, right.domains) &&
    arraysEqual(left.connectors, right.connectors) &&
    arraysEqual(left.actions, right.actions) &&
    checksEqual &&
    JSON.stringify(left.parameterConstraints ?? []) === JSON.stringify(right.parameterConstraints ?? []) &&
    JSON.stringify(left.controlMappings ?? []) === JSON.stringify(right.controlMappings ?? [])
  );
}

// Deterministic, key-sorted stringify so object key order never affects equality.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

// Canonical form of a rule's UNMODELED fields — everything the editor does not
// surface as a first-class control (priority, conditions, dynamicConditions,
// AGT-native/preserved fields, ...). isSameRule already covers modeled fields;
// this closes the gap where an inherited-immutable rule could be mutated through
// an unmodeled field (e.g. via the raw-JSON escape hatch) and still pass the
// immutability guard. The JSON round-trip drops `undefined` on both sides so a
// key present-but-undefined compares equal to an absent key.
function canonicalUnmodeledFields(rule: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    if (!MODELED_RULE_KEYS.has(key) && value !== undefined) rest[key] = value;
  }
  return stableStringify(JSON.parse(JSON.stringify(rest)));
}

// Exported for testing. True when two rules carry identical unmodeled fields.
export function unmodeledRuleFieldsMatch(
  baseline: Record<string, unknown>,
  candidate: Record<string, unknown>
): boolean {
  return canonicalUnmodeledFields(baseline) === canonicalUnmodeledFields(candidate);
}

export async function createDraftRuleRevisionDecision(input: {
  branchId: string;
  baseRevisionId: string;
  message: string;
  workspaceSlug?: string;
}): Promise<DraftRevisionState> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: input.workspaceSlug });
  const tenantId = workspaceContext.tenantId;

  const baseRevision = await getRevisionForDraft({ tenantId, branchId: input.branchId, revisionId: input.baseRevisionId });
  if (!baseRevision) return { error: "Base revision not found on this branch." };

  const { actor } = await getActiveActor({
    workspaceId: baseRevision.workspace_id ?? workspaceContext.workspaceId,
    tenantId,
  });
  const adminCheck = requireActorAdminWorkspace(
    actor,
    baseRevision.workspace_slug ?? workspaceContext.workspaceSlug
  );
  if (!adminCheck.allowed) {
    await insertAuthorizationDenialEvent({
      tenantId,
      action: "revision.draft",
      reason: adminCheck.reason,
      resourceType: "policy_branch",
      resourceId: input.branchId,
      principalId: actor.id,
      workspaceId: baseRevision.workspace_id,
    }).catch(() => {});
    return { error: adminCheck.reason };
  }

  const baseSourceDocument =
    baseRevision.source_document && typeof baseRevision.source_document === "object"
      ? (baseRevision.source_document as Record<string, unknown>)
      : {};
  const baseMetadata =
    baseSourceDocument.metadata && typeof baseSourceDocument.metadata === "object"
      ? (baseSourceDocument.metadata as Record<string, unknown>)
      : {};
  if (baseMetadata.draft === true) {
    return {
      error: "This revision is already a draft. Commit it or switch to a non-draft revision before creating another draft.",
    };
  }

  const baseRules = await listRulesForRevision(input.baseRevisionId, tenantId).catch(() => []);

  // Copy base rules verbatim into the draft document. Projecting to a subset
  // here would strip parameterConstraints, controlMappings, and AGT-native
  // fields from the draft before the reviewer ever edits it.
  const rulesForDocument = baseRules.map((rule) => ({ ...rule }));

  const draftSourceDocument = {
    ...baseSourceDocument,
    rules: rulesForDocument,
    metadata: {
      ...(baseSourceDocument.metadata && typeof baseSourceDocument.metadata === "object"
        ? (baseSourceDocument.metadata as Record<string, unknown>)
        : {}),
      draft: true,
      draftBaseRevisionId: input.baseRevisionId,
      draftCreatedAt: new Date().toISOString(),
    },
  };
  const sourceHash = `sha256:${createHash("sha256")
    .update(JSON.stringify(draftSourceDocument))
    .digest("hex")
    .slice(0, 16)}`;
  const draftRevisionId = crypto.randomUUID();

  try {
    await createDraftRevision({
      tenantId,
      draftRevisionId,
      branchId: input.branchId,
      baseRevisionId: input.baseRevisionId,
      baseWorkspaceId: baseRevision.workspace_id,
      sourceFormat: baseRevision.source_format,
      sourcePath: baseRevision.source_path ?? "ui/review-rule-editor",
      sourceDocument: draftSourceDocument,
      sourceHash,
      actorId: actor.id,
      message: input.message || `Draft from ${input.baseRevisionId.slice(0, 8)}`,
    });
  } catch (err) {
    logger.error("[createDraftRuleRevisionDecision] database error:", { error: err instanceof Error ? err.message : String(err) });
    return { error: "An unexpected error occurred. Please try again." };
  }

  return {
    revisionId: draftRevisionId,
    sourceHash,
    ruleCount: baseRules.length,
  };
}

// Parse and validate the JSON rules payload from the editor.
export function parseRulesPayload(rulesPayload: string): { rules: RuleAuthoringInput[] } | { error: string } {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rulesPayload);
  } catch {
    return { error: "Invalid rule payload format." };
  }

  if (!Array.isArray(parsedPayload) || parsedPayload.length === 0) {
    return { error: "At least one rule is required to commit a revision." };
  }

  const rules = parsedPayload
    .map((row) => normalizeRuleAuthoringInput(row))
    .filter((row): row is RuleAuthoringInput => row !== null);

  if (rules.length !== parsedPayload.length) {
    return { error: "One or more rules are invalid. Check stable rule ID, title, and effect." };
  }

  const stableIds = new Set<string>();
  for (const rule of rules) {
    if (stableIds.has(rule.stableRuleId)) {
      return { error: `Duplicate stable rule ID: ${rule.stableRuleId}` };
    }
    stableIds.add(rule.stableRuleId);
  }

  const reservedRuleIdError = reservedStableRuleIdError(stableIds);
  if (reservedRuleIdError) return { error: reservedRuleIdError };

  return { rules };
}

export async function commitRuleRevisionDecision(input: {
  branchId: string;
  parentRevisionId: string;
  sourcePath?: string;
  message?: string;
  rulesPayload: string;
  workspaceSlug?: string;
}): Promise<CommitRevisionState> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: input.workspaceSlug });
  const tenantId = workspaceContext.tenantId;

  const parsedRules = parseRulesPayload(input.rulesPayload);
  if ("error" in parsedRules) return parsedRules;
  const { rules } = parsedRules;

  const branch = await getBranchForRollback({ tenantId, branchId: input.branchId });
  if (!branch) return { error: "Branch not found." };

  // The parent revision must belong to the target branch (within this tenant),
  // not merely to the tenant. Without this, a crafted request could parent a new
  // revision on branch B off branch A's revision — corrupting lineage and
  // applying A's immutable baseline instead of B's. Mirrors the draft path.
  const parentRevision = await getRevisionForDraft({
    tenantId,
    branchId: input.branchId,
    revisionId: input.parentRevisionId,
  });
  if (!parentRevision) return { error: "Parent revision not found on this branch." };

  const { actor } = await getActiveActor({
    workspaceId: branch.workspace_id ?? workspaceContext.workspaceId,
    tenantId,
  });
  const adminCheck = requireActorAdminWorkspace(
    actor,
    branch.workspace_slug ?? workspaceContext.workspaceSlug
  );
  if (!adminCheck.allowed) {
    await insertAuthorizationDenialEvent({
      tenantId,
      action: "revision.commit",
      reason: adminCheck.reason,
      resourceType: "policy_branch",
      resourceId: input.branchId,
      principalId: actor.id,
      workspaceId: branch.workspace_id,
    }).catch(() => {});
    return { error: adminCheck.reason };
  }

  const parentRules = await listRulesForRevision(input.parentRevisionId, tenantId).catch(() => []);
  const immutableRules = parentRules.filter((r) => r.immutable);

  for (const immutableRule of immutableRules) {
    const baseline: RuleAuthoringInput = {
      stableRuleId: immutableRule.stableRuleId,
      title: immutableRule.title,
      effect: immutableRule.effect as RuleAuthoringInput["effect"],
      domains: immutableRule.domains ?? [],
      connectors: immutableRule.connectors ?? [],
      actions: immutableRule.actions ?? [],
      immutable: immutableRule.immutable,
      semanticChecks: immutableRule.semanticChecks,
      parameterConstraints: immutableRule.parameterConstraints,
      controlMappings: immutableRule.controlMappings,
    };
    const candidate = rules.find((rule) => rule.stableRuleId === baseline.stableRuleId);
    if (
      !candidate ||
      !isSameRule(baseline, candidate) ||
      !unmodeledRuleFieldsMatch(immutableRule as unknown as Record<string, unknown>, candidate)
    ) {
      return {
        error: `Immutable inherited rule ${baseline.stableRuleId} cannot be changed or removed.`,
      };
    }
  }

  const revisionId = crypto.randomUUID();
  const sourceDocument = {
    rules,
    metadata: {
      authoredInApp: true,
      parentRevisionId: input.parentRevisionId,
      committedAt: new Date().toISOString(),
    },
  };
  const sourceText = JSON.stringify(sourceDocument);
  const sourceHash = `sha256:${createHash("sha256").update(sourceText).digest("hex").slice(0, 16)}`;

  const ruleRows = rules.map((rule) => ({
    tenant_id: tenantId,
    workspace_id: branch.workspace_id,
    branch_id: input.branchId,
    revision_id: revisionId,
    stable_rule_id: rule.stableRuleId,
    title: rule.title,
    effect: rule.effect,
    source_path: input.sourcePath || "ui/review-rule-editor",
    domains: rule.domains,
    connectors: rule.connectors,
    actions: rule.actions,
    immutable: rule.immutable,
  }));

  try {
    await createCommittedRevision({
      tenantId,
      revisionId,
      branchId: input.branchId,
      branchWorkspaceId: branch.workspace_id,
      parentRevisionId: input.parentRevisionId,
      sourcePath: input.sourcePath || "ui/review-rule-editor",
      sourceDocument,
      sourceHash,
      actorId: actor.id,
      message: input.message || "Commit via in-app rule editor",
      rules: ruleRows,
    });
  } catch (err) {
    logger.error("[commitRuleRevisionDecision] database error:", { error: err instanceof Error ? err.message : String(err) });
    return { error: "An unexpected error occurred. Please try again." };
  }

  return { revisionId, sourceHash, ruleCount: rules.length };
}
