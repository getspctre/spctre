import { getReviewPageModel } from "@/app/review/review-page-model";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { PageHeader } from "@spctre/ui";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RuleAuthoringPanel } from "../review/rule-authoring-panel";

export async function AuthorPageContent({
  workspaceSlug,
  searchParams
}: {
  workspaceSlug?: string;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { branch: selectedBranchId } = await searchParams;
  const model = await getReviewPageModel({ workspaceSlug, selectedBranchId });
  const t = await getTranslations("author");

  return (
    <>
      <PageHeader
        eyebrow={formatWorkspaceEyebrow(model.workspaceContext)}
        title={model.activeBranch ? t("branch_title", { branch: model.activeBranch.name }) : t("title")}
        actions={
          <a className="button" href={buildWorkspacePath(model.workspaceContext.workspaceSlug)}>
            <ArrowLeft size={16} />
            {t("back_to_policies")}
          </a>
        }
      />
      {model.usingRealBranch && model.activeBranch?.activeRevision ? (
        <RuleAuthoringPanel
          branchId={model.activeBranch.id}
          parentRevisionId={model.activeBranch.activeRevision}
          rules={model.activeRevisionRules}
          viewMode={model.appViewMode}
          vocabulary={model.authoringVocabulary}
          coverage={model.enforcementCoverage}
        />
      ) : (
        <section className="panel">
          <div className="emptyState">
            <h3>{t("empty_title")}</h3>
            <p className="meta">{t("empty_body")}</p>
          </div>
        </section>
      )}
    </>
  );
}
