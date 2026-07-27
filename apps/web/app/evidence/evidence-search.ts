import type { EvidenceLayer, RuntimeDecisionStatus, RuntimeEvidenceSearchQuery, RuntimeStack, TriggerKind } from "@spctre/policy-schema";

export type EvidenceSearchParams = Record<string, string | string[] | undefined>;
export type RuleAnalysisTab = "friction" | "unused";

export const EVIDENCE_STATUSES: RuntimeDecisionStatus[] = ["DENY", "WARN", "ALLOW"];
export const EVIDENCE_RUNTIME_STACKS: RuntimeStack[] = [
  "AWS_BEDROCK",
  "GOOGLE_ADK",
  "AZURE_AI",
  "LANGCHAIN",
  "LANGGRAPH",
  "CREWAI",
  "AUTOGEN",
  "OPENAI_AGENTS",
  "OMNIGENT",
  "OPENCODE",
  "CLAUDE_CODE",
  "HERMES",
  "OPENCLAW",
  "NEMOCLAW",
  "CLAUDE_COWORK",
  "ODYSSEUS",
  "PAPERCLIP",
  "LOCAL",
  "CUSTOM"
];

const EVIDENCE_TRIGGER_KINDS: TriggerKind[] = [
  "interactive",
  "scheduled",
  "mobile_dispatch",
  "inbound_webhook",
  "routine",
  "gateway_message",
];

const EVIDENCE_LAYERS: EvidenceLayer[] = ["agent", "sandbox"];

export function getEvidenceSearchQuery(params: EvidenceSearchParams): RuntimeEvidenceSearchQuery {
  const hasFilters = ["q", "status", "connector", "stack", "triggerKind", "layer", "branch", "revision", "from", "to"].some(
    (key) => Object.prototype.hasOwnProperty.call(params, key)
  );
  const status = enumParam(params.status, EVIDENCE_STATUSES);
  const stack = enumParam(params.stack, EVIDENCE_RUNTIME_STACKS);
  const triggerKind = enumParam(params.triggerKind, EVIDENCE_TRIGGER_KINDS);
  const layer = enumParam(params.layer, EVIDENCE_LAYERS);
  const text = textParam(params.q);
  const connector = textParam(params.connector);
  const branchId = textParam(params.branch);
  const revisionId = textParam(params.revision);
  const from = dateParam(params.from, "from");
  const to = dateParam(params.to, "to");

  return {
    text: text ?? (hasFilters ? undefined : "refund"),
    statuses: status ? [status] : hasFilters ? undefined : ["DENY"],
    runtimeStacks: stack ? [stack] : undefined,
    triggerKinds: triggerKind ? [triggerKind] : undefined,
    layers: layer ? [layer] : undefined,
    connectors: connector ? [connector] : hasFilters ? undefined : ["stripe"],
    branchId,
    revisionId,
    from,
    to,
    limit: 5
  };
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Keyset pagination href: preserves the active filters and swaps the opaque
// cursor. A null cursor (first page) omits the param entirely. See
// database-optimizations-audit finding 7. (`page` is stripped for back-compat
// with any bookmarked offset-style URLs.)
export function buildEvidenceCursorHref(
  evidencePath: string,
  params: EvidenceSearchParams,
  cursor: string | null
): string {
  const urlParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "cursor" || key === "page" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) urlParams.append(key, item);
    } else {
      urlParams.set(key, value);
    }
  }

  if (cursor) urlParams.set("cursor", cursor);
  const qs = urlParams.toString();
  return `${evidencePath}${qs ? `?${qs}` : ""}#evidence`;
}

export function getRuleAnalysisTab(params: EvidenceSearchParams): RuleAnalysisTab {
  return firstParam(params.ruleAnalysis) === "unused" ? "unused" : "friction";
}

export function buildRuleAnalysisHref(
  evidencePath: string,
  params: EvidenceSearchParams,
  tab: RuleAnalysisTab
): string {
  const urlParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "ruleAnalysis" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) urlParams.append(key, item);
    } else {
      urlParams.set(key, value);
    }
  }

  if (tab === "unused") {
    urlParams.set("ruleAnalysis", tab);
  }

  const query = urlParams.toString();
  return `${evidencePath}${query ? `?${query}` : ""}#intelligence`;
}

function textParam(value: string | string[] | undefined): string | undefined {
  const text = firstParam(value)?.trim();
  return text ? text : undefined;
}

function enumParam<const TValue extends string>(
  value: string | string[] | undefined,
  allowed: readonly TValue[]
): TValue | undefined {
  const text = textParam(value);
  return allowed.find((allowedValue) => allowedValue === text);
}

function dateParam(
  value: string | string[] | undefined,
  boundary: "from" | "to"
): string | undefined {
  const date = textParam(value);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined;
  }

  return boundary === "from" ? `${date}T00:00:00.000Z` : `${date}T23:59:59.999Z`;
}
