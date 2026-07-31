import { evaluateDecision, type PolicyRuleSummary, type RuntimeDecisionStatus, type RuntimeDecisionEvidenceRecord } from "@spctre/policy-schema";
import { getWorkspaceContext } from "@/lib/workspace";
import { runWithTenantContext } from "@/lib/tenant-context";
import { listRuntimeEvidence } from "@/lib/repositories/evidence/runtime";
import { swallow } from "@/lib/platform/swallow";

/**
 * Ephemeral, authoring-time simulation: replay the DRAFT (uncommitted) rule set
 * over recent retained evidence and report what would change. This is the
 * example-decision tester batched over real traffic — distinct from the managed,
 * persisted simulation runs (simulation_run / simulation_replay_finding), which
 * apply to committed revisions. Nothing is written; the draft never needs to be
 * committed to preview its blast radius.
 */
export interface DraftSimulationFinding {
  decisionId: string;
  connector: string;
  action: string;
  previousStatus: string;
  proposedStatus: RuntimeDecisionStatus;
  reason: string;
  matchedPolicyRefs: string[];
}

export interface DraftSimulationSummary {
  sampled: number;
  unchanged: number;
  changed: number;
  /**
   * Decisions whose proposed outcome depends on a domain-scoped rule. Evidence
   * does not persist the request's domain, so we cannot tell whether such a rule
   * actually applied — counting them as matches would overstate impact. Reported
   * separately instead of as changed/unchanged.
   */
  indeterminate: number;
  /** Status transitions, e.g. { transition: "ALLOW→DENY", count: 3 }, most frequent first. */
  transitions: { transition: string; count: number }[];
  /** A capped sample of the changed decisions for inspection. */
  findings: DraftSimulationFinding[];
}

const SAMPLE_LIMIT = 100;
const FINDINGS_LIMIT = 25;

type SimulatableRecord = Pick<
  RuntimeDecisionEvidenceRecord,
  "decisionId" | "connector" | "action" | "status" | "toolIntent" | "planSummary" | "toolParameters"
>;

// Pure: replay a rule set over a set of retained decisions. Extracted from the
// DB-bound entrypoint so it can be tested against the real evaluateDecision
// without a database.
export function buildDraftSimulationSummary(
  records: SimulatableRecord[],
  rules: PolicyRuleSummary[]
): DraftSimulationSummary {
  // Rules that apply regardless of the request's domain. evaluateDecision treats
  // an empty input-domain list as a wildcard, so a domain-scoped rule would
  // falsely match every record with the same connector/action. We only trust an
  // outcome when the domain-agnostic rules alone produce it; if a domain-scoped
  // rule would change it, the request domain is unknown and the record is
  // indeterminate.
  const domainAgnosticRules = rules.filter((rule) => (rule.domains?.length ?? 0) === 0);

  let unchanged = 0;
  let indeterminate = 0;
  const transitions = new Map<string, number>();
  const findings: DraftSimulationFinding[] = [];

  for (const record of records) {
    const input = {
      connector: record.connector,
      action: record.action,
      domains: [] as string[],
      toolIntent: record.toolIntent ?? "",
      planSummary: record.planSummary ?? "",
      toolParameters: record.toolParameters ?? {},
    };
    const optimistic = evaluateDecision({ ...input, rules });
    const definite = evaluateDecision({ ...input, rules: domainAgnosticRules });

    // A domain-scoped rule changes the outcome under an unknown domain.
    if (optimistic.status !== definite.status) {
      indeterminate += 1;
      continue;
    }

    if (definite.status === record.status) {
      unchanged += 1;
      continue;
    }

    const transition = `${record.status}→${definite.status}`;
    transitions.set(transition, (transitions.get(transition) ?? 0) + 1);
    if (findings.length < FINDINGS_LIMIT) {
      findings.push({
        decisionId: record.decisionId,
        connector: record.connector,
        action: record.action,
        previousStatus: record.status,
        proposedStatus: definite.status,
        reason: definite.reason,
        matchedPolicyRefs: definite.matchedRefs,
      });
    }
  }

  return {
    sampled: records.length,
    unchanged,
    changed: records.length - unchanged - indeterminate,
    indeterminate,
    transitions: [...transitions.entries()]
      .map(([transition, count]) => ({ transition, count }))
      .sort((left, right) => right.count - left.count),
    findings,
  };
}

export async function simulateDraftAgainstEvidence(input: {
  rules: PolicyRuleSummary[];
  workspaceSlug?: string;
}): Promise<{ summary: DraftSimulationSummary }> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: input.workspaceSlug });
  const { tenantId, workspaceId } = workspaceContext;

  const evidence = await runWithTenantContext(tenantId, () =>
    listRuntimeEvidence(workspaceId, tenantId, SAMPLE_LIMIT, 0)
  ).catch(swallow("runWithTenantContext", []));

  return { summary: buildDraftSimulationSummary(evidence, input.rules) };
}
