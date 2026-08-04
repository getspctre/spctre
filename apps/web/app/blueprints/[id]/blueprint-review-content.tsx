import Link from "next/link";
import { ArrowLeft, Bot, FileCode2, GitCompare, ShieldCheck } from "lucide-react";
import type { AgentBlueprintDefinition, AgentBlueprintRevision } from "@spctre/policy-schema";
import { diffAgentBlueprintRevisions, evaluatePublishReadiness } from "@spctre/policy-schema";
import { getWorkspaceContext, formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { getAgentBlueprint, getAgentBlueprintApprovals } from "@/lib/domains/agent-blueprints/service";
import { getApprovalWorkflowForContext, approvalRulesFromWorkflow } from "@/lib/repositories/approval-workflow";
import { getActiveActor, canActorReviewRole, requireActorAdminWorkspace, getBranchPermissions } from "@/lib/actors";
import { ALL_REVIEWER_ROLES } from "@/lib/approval-config";
import { hashToFingerprint } from "@/lib/fingerprint";
import { swallow } from "@/lib/platform/swallow";
import {
  BlueprintApprovalGrid,
  BlueprintLifecycleActions,
  BlueprintRollbackButton,
  BlueprintSimulatePanel,
  type BlueprintApprovalRole,
} from "./blueprint-review-actions";

const statusPill = (status: string) =>
  status === "PUBLISHED" ? "pillAllow" : status === "IN_REVIEW" ? "pillWarn" : "pillNeutral";

function ChipRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="blueprintDefRow">
      <span className="meta">{label}</span>
      {values.length ? (
        <div className="blueprintChipList blueprintDefChips">
          {values.map((value) => <span className="blueprintChip" key={value}>{value}</span>)}
        </div>
      ) : (
        <span className="meta">None declared</span>
      )}
    </div>
  );
}

function DefinitionInspector({ definition }: { definition: AgentBlueprintDefinition }) {
  const budgets = definition.budgets ?? {};
  const budgetEntries = Object.entries(budgets).filter(([, value]) => value !== undefined);
  return (
    <div className="blueprintDefGrid">
      <div className="blueprintDefRow blueprintDefWide">
        <span className="meta">Purpose</span>
        <p>{definition.purpose}</p>
      </div>
      <ChipRow label="Task classes" values={definition.allowedTaskClasses} />
      <ChipRow label="Tools" values={definition.tools} />
      <ChipRow label="Connectors" values={definition.connectors} />
      <ChipRow label="Services" values={definition.services} />
      <ChipRow label="Environments" values={definition.environments} />
      <div className="blueprintDefRow blueprintDefWide">
        <span className="meta">Runtime targets</span>
        {definition.runtimeTargets.length ? (
          <div className="blueprintChipList blueprintDefChips">
            {definition.runtimeTargets.map((target, index) => (
              <span className="blueprintChip" key={`${target.stack}-${index}`}>
                {target.stack.replaceAll("_", " ")}{target.environment ? ` · ${target.environment}` : ""}{target.adapter ? ` · ${target.adapter}` : ""}
              </span>
            ))}
          </div>
        ) : <span className="meta">None declared</span>}
      </div>
      {definition.approvalPath?.length ? <ChipRow label="Approval path" values={definition.approvalPath} /> : null}
      {budgetEntries.length ? (
        <div className="blueprintDefRow blueprintDefWide">
          <span className="meta">Session budgets</span>
          <div className="blueprintChipList blueprintDefChips">
            {budgetEntries.map(([key, value]) => <span className="blueprintChip" key={key}>{key}: {value}</span>)}
          </div>
        </div>
      ) : null}
      <div className="blueprintDefRow">
        <span className="meta">Policy binding</span>
        {definition.policyRevisionId ? (
          <code className="smallCode">{hashToFingerprint(definition.policyRevisionId)}</code>
        ) : <span className="meta">Unbound</span>}
      </div>
    </div>
  );
}

export async function BlueprintReviewContent({
  workspaceSlug,
  blueprintId,
  selectedRevisionId,
}: {
  workspaceSlug?: string;
  blueprintId: string;
  selectedRevisionId?: string;
}) {
  const workspace = await getWorkspaceContext({ workspaceSlug });
  const path = (suffix: string) => (workspace.workspaceSlug ? buildWorkspacePath(workspace.workspaceSlug, suffix) : suffix);
  const blueprintsPath = path("/blueprints");

  const result = await getAgentBlueprint({
    tenantId: workspace.tenantId,
    workspaceId: workspace.workspaceId,
    blueprintId,
  });

  if (!result) {
    return (
      <>
        <section className="topbar"><div><p className="eyebrow">{formatWorkspaceEyebrow(workspace)}</p><h1>Blueprint</h1></div></section>
        <section className="panel"><div className="emptyState"><Bot size={20} className="sectionIcon" /><h3>Blueprint not found</h3><p className="meta">This Blueprint does not exist in {workspace.workspaceName ?? "this workspace"}, or you do not have access to it.</p><Link className="button buttonPrimary emptyStateAction" href={blueprintsPath}><ArrowLeft size={16} />Back to Blueprints</Link></div></section>
      </>
    );
  }

  const { blueprint, revisions } = result;
  const headRevision =
    revisions.find((revision) => revision.id === blueprint.activeRevisionId) ?? revisions[0];
  const inspected =
    (selectedRevisionId ? revisions.find((revision) => revision.id === selectedRevisionId) : undefined) ?? headRevision;
  const inspectingHistorical = inspected.id !== headRevision.id;

  const parent = inspected.parentRevisionId
    ? revisions.find((revision) => revision.id === inspected.parentRevisionId)
    : undefined;
  const diff = parent ? diffAgentBlueprintRevisions({ base: parent, compare: inspected }) : undefined;

  const [approvals, workflow, actorResult] = await Promise.all([
    getAgentBlueprintApprovals({ tenantId: workspace.tenantId, revisionId: headRevision.id }),
    getApprovalWorkflowForContext({ tenantId: workspace.tenantId, workspaceId: workspace.workspaceId }),
    getActiveActor({ workspaceId: workspace.workspaceId, tenantId: workspace.tenantId }).catch(swallow("getActiveActor", null)),
  ]);

  const approvalRules = approvalRulesFromWorkflow(workflow);
  const readiness = evaluatePublishReadiness({
    branchId: blueprint.id,
    revisionId: headRevision.id,
    approvalRules,
    approvals,
    approvalWorkflow: workflow,
  });

  const actor = actorResult?.actor ?? null;
  const actorName = actor?.name ?? "You";
  // Gate the controls against the real governing workspace slug — the same value
  // the API routes now authorize against — so the optimistic enable/disable
  // matches what the server will accept.
  const reviewSlug = workspace.workspaceSlug || "workspace-demo";
  const reviewableRoles = actor
    ? ALL_REVIEWER_ROLES.filter((role) => canActorReviewRole(actor, reviewSlug, role).allowed)
    : [];
  // Publishing mirrors the policy publish gate (publishScopes), rollback mirrors
  // policy rollback (workspace admin); submitting for review is authoring, open to
  // any workspace member (the server enforces write access).
  const publishPermission = actor
    ? getBranchPermissions({ actor, branch: { scope: "WORKSPACE", environment: undefined }, workspaceSlug: reviewSlug })
    : { canPublish: false, publishReason: "You do not have permission to publish in this workspace." };
  const canRollback = Boolean(actor && requireActorAdminWorkspace(actor, reviewSlug).allowed);
  const canTransition = headRevision.status === "DRAFT" ? Boolean(actor) : publishPermission.canPublish;
  const transitionBlockedReason = headRevision.status === "DRAFT"
    ? "You need workspace access to submit this Blueprint for review."
    : publishPermission.publishReason ?? "You do not have permission to publish in this workspace.";

  const requiredRoles = new Set(approvalRules.map((rule) => rule.role));
  const approvalRoleCards: BlueprintApprovalRole[] = ALL_REVIEWER_ROLES.map((role) => ({
    role,
    isRequired: requiredRoles.has(role),
    requiredCount: approvalRules.find((rule) => rule.role === role)?.requiredCount,
    approvals: approvals.filter((approval) => approval.role === role),
  }));

  const isPublished = headRevision.status === "PUBLISHED";
  const canPublish = headRevision.status === "IN_REVIEW" && readiness.status === "READY";
  const publishBlockedReason = readiness.blockingReasons[0]?.message;

  const inspectPath = (revisionId: string) =>
    revisionId === headRevision.id ? path(`/blueprints/${blueprint.id}`) : `${path(`/blueprints/${blueprint.id}`)}?rev=${encodeURIComponent(revisionId)}`;

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspace)}</p>
          <h1>{blueprint.name}</h1>
          <p className="meta">Agent <code className="smallCode">{blueprint.agentId}</code> · Head revision <code className="smallCode">{hashToFingerprint(headRevision.id)}</code></p>
        </div>
        <div className="toolbar">
          <Link className="button" href={blueprintsPath}><ArrowLeft size={16} />Blueprints</Link>
          <span className={`pill ${statusPill(headRevision.status)}`}>{headRevision.status.replace("_", " ")}</span>
        </div>
      </section>

      <section className="panel blueprintsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Review · Lifecycle</p>
            <h2>Advance the head revision</h2>
            <p className="meta">
              A draft is submitted for review, gathers the required approvals, then publishes to the immutable runtime contract{" "}
              <code>spctre.agent-blueprint.v1</code>.
            </p>
          </div>
        </div>
        <BlueprintLifecycleActions
          blueprintId={blueprint.id}
          revisionId={headRevision.id}
          status={headRevision.status}
          canPublish={canPublish}
          publishBlockedReason={headRevision.status === "DRAFT" ? "Submit the draft for review first." : publishBlockedReason}
          canTransition={canTransition}
          transitionBlockedReason={transitionBlockedReason}
        />
        {!isPublished && readiness.blockingReasons.length ? (
          <div className="blockerList">
            {readiness.blockingReasons.map((blocker) => (
              <div className="blockerActionRow" key={blocker.message}><p className="meta">{blocker.message}</p></div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel blueprintsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">{inspectingHistorical ? "Historical revision" : "Head revision"}</p>
            <h2>Operating envelope</h2>
            <p className="meta">
              Revision <code className="smallCode">{hashToFingerprint(inspected.id)}</code> · {inspected.message} · authored {new Date(inspected.createdAt).toLocaleString()}
            </p>
            {inspectingHistorical ? (
              <p className="meta">You are inspecting a historical revision. Review actions apply to the head revision <Link href={inspectPath(headRevision.id)}>{hashToFingerprint(headRevision.id)}</Link>.</p>
            ) : null}
          </div>
        </div>
        {diff ? (
          <div className="blockerActionRow blueprintDiffSummary">
            <GitCompare size={15} />
            <p className="meta">
              {diff.summary}{diff.changedFields.length ? ` Changed: ${diff.changedFields.join(", ")}.` : ""} (vs {hashToFingerprint(parent!.id)})
            </p>
          </div>
        ) : null}
        <DefinitionInspector definition={inspected.definition} />
      </section>

      <section className="panel blueprintsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Review · Approvals</p>
            <h2>Reviewer decisions</h2>
            <p className="meta">
              {isPublished
                ? "This revision is published; its approvals are shown for the record."
                : `Approvals recorded against the head revision. You are acting as ${actorName}.`}
            </p>
          </div>
        </div>
        <BlueprintApprovalGrid
          blueprintId={blueprint.id}
          revisionId={headRevision.id}
          roles={approvalRoleCards}
          reviewableRoles={reviewableRoles}
          reviewBlockedReason={reviewableRoles.length ? undefined : `${actorName} has no reviewer roles in this workspace.`}
          actorName={actorName}
          actorId={actor?.id}
          actionsDisabled={headRevision.status !== "IN_REVIEW"}
        />
      </section>

      <section className="panel blueprintsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Review · Impact</p>
            <h2>Simulate the envelope</h2>
            <p className="meta">Estimate how the inspected revision would constrain the agent’s recent runtime activity before you publish.</p>
          </div>
        </div>
        <BlueprintSimulatePanel blueprintId={blueprint.id} revisionId={inspected.id} />
      </section>

      <section className="panel blueprintsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Revision ledger</p>
            <h2>History</h2>
            <p className="meta">Every immutable revision, its lifecycle state, and the policy revision it governs.</p>
          </div>
          <FileCode2 size={20} className="sectionIcon" />
        </div>
        <div className="auditTableWrapper">
          <table className="auditTable">
            <thead><tr><th>Revision</th><th>Lifecycle</th><th>Policy revision</th><th>Note</th><th>Created</th><th /></tr></thead>
            <tbody>
              {revisions.map((revision: AgentBlueprintRevision) => {
                const isHead = revision.id === headRevision.id;
                const isInspected = revision.id === inspected.id;
                return (
                  <tr key={revision.id} className={`auditRow${isInspected ? " blueprintRevisionActive" : ""}`}>
                    <td>
                      <code className="smallCode">{hashToFingerprint(revision.id)}</code>
                      {isHead ? <span className="pill pillNeutral blueprintHeadTag">head</span> : null}
                    </td>
                    <td><span className={`pill ${statusPill(revision.status)}`}>{revision.status.replace("_", " ")}</span></td>
                    <td>{revision.definition.policyRevisionId ? <code className="smallCode">{hashToFingerprint(revision.definition.policyRevisionId)}</code> : <span className="meta">Unbound</span>}</td>
                    <td>{revision.message}</td>
                    <td className="meta">{new Date(revision.createdAt).toLocaleString()}</td>
                    <td className="blueprintRevisionActions">
                      {isInspected ? <span className="meta">Inspecting</span> : <Link className="button buttonSmall" href={inspectPath(revision.id)}><FileCode2 size={13} />Inspect</Link>}
                      {revision.status === "PUBLISHED" && !isHead ? (
                        <BlueprintRollbackButton
                          blueprintId={blueprint.id}
                          targetRevisionId={revision.id}
                          canRollback={canRollback}
                          blockedReason={canRollback ? undefined : "Admin permission is required to roll back."}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel blueprintsPanel">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Runtime contract</p>
            <h2>Published output</h2>
            <p className="meta">Once published, gateway decisions bind this agent and its policy revision, then abort undeclared connector or tool actions.</p>
          </div>
          <ShieldCheck size={20} className="sectionIcon" />
        </div>
      </section>
    </>
  );
}
