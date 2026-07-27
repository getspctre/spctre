import { GitPullRequestArrow, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SettingsHeader } from "@/components/settings-header";
import { PlanGate } from "@/app/plan-gate";
import { getActiveScope } from "@/lib/workspace";
import { getWorkflowsPageModel } from "@/lib/domains/workflows/service";

import { WorkflowInspectorTable } from "./workflow-inspector-table";

export const dynamic = "force-dynamic";

export default async function AdminWorkflowsPage() {
  const t = await getTranslations("admin.workflows");
  const { workflows, workspaces, auditEvents, enabledCount } = await getWorkflowsPageModel(await getActiveScope());

  return (
    <>
      <SettingsHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <span className="pill pillNeutral">{t("counts.workflows", { count: workflows.length })}</span>
            <span className="pill pillAllow">{t("counts.enabled", { count: enabledCount })}</span>
          </>
        }
      />

      <div className="adminAuthLayout">
        <section className="adminAuthStack" aria-label={t("builder_aria_label")}>
          <div className="adminAuthSectionHeader">
            <GitPullRequestArrow size={18} aria-hidden />
            <div>
              <p className="eyebrow">{t("rules.eyebrow")}</p>
              <h2>{t("rules.title")}</h2>
            </div>
          </div>

          <WorkflowInspectorTable workflows={workflows} enabledCount={enabledCount} workspaces={workspaces} />
        </section>

        <aside className="adminAuthSidebar" aria-label={t("sidebar_aria_label")}>
          <PlanGate feature="managedWorkflowEnforcement">
            <section className="adminAuthPanel">
              <div className="adminAuthPanelHeader">
                <div>
                  <p className="eyebrow">{t("enforcement.eyebrow")}</p>
                  <h2>{t("enforcement.title")}</h2>
                </div>
                <span className="pill pillAllow">{t("cloud")}</span>
              </div>
              <p className="meta">
                {t("enforcement.description")}
              </p>
            </section>
          </PlanGate>

          <section className="adminAuthPanel">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">{t("audit.eyebrow")}</p>
                <h2>{t("audit.title")}</h2>
              </div>
              <ShieldCheck size={18} aria-hidden />
            </div>
            <div className="adminAuthList">
              {auditEvents.length ? (
                auditEvents.map((event) => (
                  <article className="adminAuthRecord" key={event.id}>
                    <div className="rowHeader">
                      <div>
                        <h3>{event.action.replaceAll("_", " ").toLowerCase()}</h3>
                        <p className="meta">{new Date(event.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="pill pillNeutral">{t("audit.badge")}</span>
                    </div>
                    <code>{event.workflowId ?? t("audit.workflow_fallback")}</code>
                  </article>
                ))
              ) : (
                <div className="adminAuthEmpty">
                  <ShieldCheck size={18} aria-hidden />
                  <div>
                    <h3>{t("audit.empty_title")}</h3>
                    <p className="meta">{t("audit.empty_description")}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
