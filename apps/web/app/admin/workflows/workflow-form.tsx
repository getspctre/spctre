"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { REVIEWER_ROLES } from "@/lib/rbac";
import type { ApprovalWorkflowConfigSummary } from "@/lib/domains/workflows/service";
import { upsertApprovalWorkflow, type WorkflowActionState } from "./workflow-actions";

const initialState: WorkflowActionState = null;

function deriveRuleDefaults(workflow: ApprovalWorkflowConfigSummary | undefined) {
  const defaultRule = workflow?.rules[0];
  return {
    role: defaultRule?.role ?? "Security",
    requiredCount: defaultRule?.requiredCount ?? 1,
    isRoleEligible: (role: string) => defaultRule?.eligibleRoles?.includes(role) ?? role === "Security",
  };
}

// Prefill values for the form, falling back to sensible new-workflow defaults.
function deriveWorkflowFormDefaults(
  workflow: ApprovalWorkflowConfigSummary | undefined,
  workspaces: { id: string }[]
) {
  return {
    workspaceId: workflow?.workspaceId ?? workspaces[0]?.id ?? "TENANT",
    name: workflow?.name ?? "Production approval workflow",
    reviewMode: workflow?.reviewMode ?? "PARALLEL",
    environment: workflow?.environment ?? "",
    requireVerification: workflow?.verificationPolicy?.requireVerification ?? false,
    allowImmediatePackPublish: workflow?.allowImmediatePackPublish ?? false,
    ...deriveRuleDefaults(workflow),
  };
}

function RequiredRuleFieldset({ defaults }: { defaults: ReturnType<typeof deriveWorkflowFormDefaults> }) {
  const t = useTranslations("admin.workflows.form");
  return (
    <fieldset className="adminAuthFieldset">
      <legend>{t("required_rule")}</legend>
      <div className="adminAuthTwoColumn">
        <label className="field">
          <span>{t("approval_role")}</span>
          <select className="input" name="role" defaultValue={defaults.role}>
            {REVIEWER_ROLES.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("required_count")}</span>
          <input
            className="input"
            name="requiredCount"
            type="number"
            min={1}
            max={10}
            defaultValue={defaults.requiredCount}
          />
        </label>
      </div>

      <div className="adminAuthChipGrid">
        {REVIEWER_ROLES.map((role) => (
          <label key={role} className="adminAuthOption">
            <input
              type="checkbox"
              name="eligibleRole"
              value={role}
              defaultChecked={defaults.isRoleEligible(role)}
            />
            <span>{role}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function WorkflowForm({
  workspaces,
  workflow,
}: {
  workspaces: { id: string; name: string; slug: string }[];
  workflow?: ApprovalWorkflowConfigSummary;
}) {
  const t = useTranslations("admin.workflows.form");
  const [state, action, pending] = useActionState(upsertApprovalWorkflow, initialState);
  const defaults = deriveWorkflowFormDefaults(workflow, workspaces);

  return (
    <form action={action} className="adminAuthForm">
      {workflow ? <input type="hidden" name="workflowId" value={workflow.id} /> : null}
      <div className="adminAuthFormIntro">
        <h3>{workflow ? t("edit_title") : t("create_title")}</h3>
        <p className="meta">
          {workflow
            ? t("edit_description")
            : t("create_description")}
        </p>
      </div>

      <div className="adminAuthTwoColumn">
        <label className="field">
          <span>{t("name")}</span>
          <input
            className="input"
            name="name"
            defaultValue={defaults.name}
            required
          />
        </label>
        <label className="field">
          <span>{t("review_mode")}</span>
          <select className="input" name="reviewMode" defaultValue={defaults.reviewMode}>
            <option value="PARALLEL">{t("review_modes.parallel")}</option>
            <option value="SEQUENTIAL">{t("review_modes.sequential")}</option>
          </select>
        </label>
      </div>

      <div className="adminAuthTwoColumn">
        <label className="field">
          <span>{t("workspace_scope")}</span>
          <select className="input" name="workspaceId" defaultValue={defaults.workspaceId}>
            <option value="TENANT">{t("tenant_default")}</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} ({workspace.slug})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("environment")}</span>
          <input className="input" name="environment" placeholder={t("environment_placeholder")} defaultValue={defaults.environment} />
        </label>
      </div>

      <label className="adminAuthCheck">
        <input
          type="checkbox"
          name="requireVerification"
          defaultChecked={defaults.requireVerification}
        />
        <span>
          <strong>{t("require_verification")}</strong>
          <span className="meta">{t("require_verification_description")}</span>
        </span>
      </label>

      <label className="adminAuthCheck">
        <input
          type="checkbox"
          name="allowImmediatePackPublish"
          defaultChecked={defaults.allowImmediatePackPublish}
        />
        <span>
          <strong>{t("allow_immediate_publish")}</strong>
          <span className="meta">{t("allow_immediate_publish_description")}</span>
        </span>
      </label>

      <RequiredRuleFieldset defaults={defaults} />

      <button className="button buttonPrimary" type="submit" disabled={pending}>
        {pending ? t("saving") : workflow ? t("save_changes") : t("save_workflow")}
      </button>

      {state?.error ? <p className="meta workspaceError">{state.error}</p> : null}
      {state?.ok ? <p className="meta">{state.message}</p> : null}
    </form>
  );
}
