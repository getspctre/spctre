"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SlideOutPanel } from "@/app/slide-out-panel";
import type { ApprovalWorkflowConfigSummary } from "@/lib/domains/workflows/service";
import { WorkflowForm } from "./workflow-form";
import {
  disableApprovalWorkflow,
  removeApprovalWorkflowRule,
  type WorkflowActionState,
} from "./workflow-actions";

interface WorkflowInspectorTableProps {
  workflows: ApprovalWorkflowConfigSummary[];
  enabledCount: number;
  workspaces: { id: string; name: string; slug: string }[];
}

function formatScope(workflow: ApprovalWorkflowConfigSummary, tenantDefault: string) {
  const workspace = workflow.workspaceName ?? tenantDefault;
  return workflow.environment ? `${workspace} / ${workflow.environment}` : workspace;
}

function summarizeRules(
  workflow: ApprovalWorkflowConfigSummary,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string {
  if (!workflow.rules.length) return t("no_rules");
  if (workflow.rules.length === 1) return t("one_rule", { role: workflow.rules[0].role });
  const firstTwo = workflow.rules
    .slice(0, 2)
    .map((rule) => rule.role)
    .join(", ");
  const remaining = workflow.rules.length - 2;
  return remaining > 0 ? `${firstTwo} +${remaining}` : firstTwo;
}

const initialState: WorkflowActionState = null;

function DisableWorkflowForm({
  workflow,
  enabledCount,
  onSuccess,
}: {
  workflow: ApprovalWorkflowConfigSummary;
  enabledCount: number;
  onSuccess: (message: string) => void;
}) {
  const t = useTranslations("admin.workflows.table");
  const [state, action, pending] = useActionState(disableApprovalWorkflow, initialState);
  const disableBlocked = workflow.enabled && enabledCount <= 1;

  useEffect(() => {
    if (state?.ok) {
      onSuccess(state.message);
    }
  }, [onSuccess, state]);

  return (
    <form action={action} className="adminAuthPanelActions">
      <input type="hidden" name="workflowId" value={workflow.id} />
      <button
        className="button buttonDanger"
        disabled={!workflow.enabled || disableBlocked || pending}
        title={disableBlocked ? t("disable_blocked_title") : undefined}
        type="submit"
        onClick={(event) => {
          if (!window.confirm(t("confirm_disable", { name: workflow.name }))) {
            event.preventDefault();
          }
        }}
      >
        {pending ? t("disabling") : t("disable_workflow")}
      </button>
      {state?.error ? <p className="meta workspaceError">{state.error}</p> : null}
    </form>
  );
}

function RuleRemoveForm({
  workflow,
  rule,
  onSuccess,
}: {
  workflow: ApprovalWorkflowConfigSummary;
  rule: ApprovalWorkflowConfigSummary["rules"][number];
  onSuccess: (message: string) => void;
}) {
  const t = useTranslations("admin.workflows.table");
  const [state, action] = useActionState(removeApprovalWorkflowRule, initialState);

  useEffect(() => {
    if (state?.ok) {
      onSuccess(state.message);
    }
  }, [onSuccess, state]);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            t("confirm_remove_rule", {
              sequence: rule.sequence,
              role: rule.role,
              name: workflow.name,
            }),
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="workflowId" value={workflow.id} />
      <input type="hidden" name="ruleId" value={rule.id} />
      <button className="button buttonSmall" type="submit">
        {t("remove")}
      </button>
      {state?.error ? <p className="meta workspaceError">{state.error}</p> : null}
    </form>
  );
}

function WorkflowInspectorRow({
  workflow,
  enabledCount,
  workspaces,
}: {
  workflow: ApprovalWorkflowConfigSummary;
  enabledCount: number;
  workspaces: { id: string; name: string; slug: string }[];
}) {
  const t = useTranslations("admin.workflows.table");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const tenantDefault = t("tenant_default");

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  return (
    <tr className="auditRow" key={workflow.id}>
      <td>
        <strong>{workflow.name}</strong>
        <code>{workflow.id}</code>
      </td>
      <td>{formatScope(workflow, tenantDefault)}</td>
      <td>
        <span className="pill pillNeutral">{workflow.reviewMode}</span>
      </td>
      <td>
        <span className="meta">{summarizeRules(workflow, t)}</span>
      </td>
      <td>
        <div className="workflowRowStatus">
          <span className={workflow.enabled ? "pill pillAllow" : "pill pillNeutral"}>
            {workflow.enabled ? t("enabled") : t("disabled")}
          </span>
          <SlideOutPanel
            title={workflow.name}
            eyebrow={t("panel_eyebrow")}
            description={t("panel_description", {
              scope: formatScope(workflow, tenantDefault),
              mode: workflow.reviewMode.toLowerCase(),
            })}
            width="wide"
            trigger={({ open, triggerId }) => (
              <button className="button buttonSmall" id={triggerId} onClick={open} type="button">
                {t("inspect")}
              </button>
            )}
          >
            {toastMessage ? (
              <div className="workflowActionToast" role="status" aria-live="polite">
                {toastMessage}
              </div>
            ) : null}

            <section
              className="adminMembersInspectorSection"
              aria-label={t("rule_builder_aria_label")}
            >
              <div className="adminMembersInspectorHeader">
                <div>
                  <p className="eyebrow">{t("policy_editor_eyebrow")}</p>
                  <h3>{t("gate_configuration")}</h3>
                </div>
                <span className="pill pillNeutral">{t("configuration")}</span>
              </div>
              <WorkflowForm workspaces={workspaces} workflow={workflow} />
            </section>

            <section className="adminMembersInspectorSection" aria-label={t("details_aria_label")}>
              <div className="adminMembersInspectorHeader">
                <div>
                  <p className="eyebrow">{t("snapshot_eyebrow")}</p>
                  <h3>{t("current_state")}</h3>
                </div>
                <span className={workflow.enabled ? "pill pillAllow" : "pill pillNeutral"}>
                  {workflow.enabled ? t("enabled") : t("disabled")}
                </span>
              </div>
              <div className="adminMembersInspectorGrid">
                <div>
                  <p className="eyebrow">{t("status")}</p>
                  <span className={workflow.enabled ? "pill pillAllow" : "pill pillNeutral"}>
                    {workflow.enabled ? t("enabled") : t("disabled")}
                  </span>
                </div>
                <div>
                  <p className="eyebrow">{t("mode")}</p>
                  <strong>{workflow.reviewMode}</strong>
                </div>
                <div>
                  <p className="eyebrow">{t("rules")}</p>
                  <strong>{workflow.rules.length}</strong>
                </div>
                <div>
                  <p className="eyebrow">{t("updated")}</p>
                  <strong>{new Date(workflow.updatedAt).toLocaleString()}</strong>
                </div>
              </div>
              <code>{workflow.id}</code>
            </section>

            <section className="adminMembersInspectorSection" aria-label={t("rules_aria_label")}>
              <div className="adminMembersInspectorHeader">
                <div>
                  <p className="eyebrow">{t("rule_set_eyebrow")}</p>
                  <h3>{t("active_approval_gates")}</h3>
                </div>
                <span className="pill pillNeutral">{workflow.rules.length}</span>
              </div>
              <div className="adminMembersInspectorList">
                {workflow.rules.length ? (
                  workflow.rules.map((rule) => (
                    <div className="adminMembersInspectorItem" key={rule.id}>
                      <div>
                        <strong>
                          {rule.sequence}. {rule.role}
                        </strong>
                        <p className="meta">
                          {t("rule_required_from", {
                            count: rule.requiredCount,
                            roles: rule.eligibleRoles.join(", "),
                          })}
                        </p>
                      </div>
                      <RuleRemoveForm workflow={workflow} rule={rule} onSuccess={setToastMessage} />
                    </div>
                  ))
                ) : (
                  <div>
                    <p className="meta">{t("no_rules_configured")}</p>
                    <p className="meta">{t("fallback_behavior")}</p>
                  </div>
                )}
              </div>
            </section>

            <section
              className="adminMembersInspectorSection"
              aria-label={t("lifecycle_aria_label")}
            >
              <div className="adminMembersInspectorHeader">
                <div>
                  <p className="eyebrow">{t("lifecycle_eyebrow")}</p>
                  <h3>{t("review_impact_title")}</h3>
                </div>
                <span className="pill pillWarn">{t("rereview_required")}</span>
              </div>
              <p className="meta">{t("lifecycle_description")}</p>
              <DisableWorkflowForm
                workflow={workflow}
                enabledCount={enabledCount}
                onSuccess={setToastMessage}
              />
            </section>
          </SlideOutPanel>
        </div>
      </td>
    </tr>
  );
}

function CreateWorkflowPanel({
  workspaces,
}: {
  workspaces: { id: string; name: string; slug: string }[];
}) {
  const t = useTranslations("admin.workflows.table");
  return (
    <SlideOutPanel
      title={t("new_workflow")}
      eyebrow={t("policy_editor_eyebrow")}
      description={t("create_panel_description")}
      width="wide"
      trigger={({ open, triggerId }) => (
        <button className="button buttonSmall" id={triggerId} onClick={open} type="button">
          {t("new_workflow")}
        </button>
      )}
    >
      <WorkflowForm workspaces={workspaces} />
    </SlideOutPanel>
  );
}

export function WorkflowInspectorTable({
  workflows,
  enabledCount,
  workspaces,
}: WorkflowInspectorTableProps) {
  const t = useTranslations("admin.workflows.table");
  return (
    <div className="workflowRulesTableFrame">
      <div className="workflowRulesToolbar">
        <p className="meta">{t("toolbar_description")}</p>
        <CreateWorkflowPanel workspaces={workspaces} />
      </div>
      <div className="auditTableWrapper">
        <table className="auditTable workflowRulesTable">
          <thead>
            <tr>
              <th>{t("workflow")}</th>
              <th>{t("scope")}</th>
              <th>{t("mode")}</th>
              <th>{t("rules")}</th>
              <th>{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((workflow) => (
              <WorkflowInspectorRow
                key={workflow.id}
                workflow={workflow}
                enabledCount={enabledCount}
                workspaces={workspaces}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
