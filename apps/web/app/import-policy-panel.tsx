"use client";

import { GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { ImportForm } from "./import-form";
import { SlideOutPanel } from "./slide-out-panel";

interface ImportPolicyPanelProps {
  workspaceId: string;
  workspaceSlug: string;
  label?: string;
  variant?: "primary" | "secondary";
  initialScope?: "WORKSPACE" | "ORGANIZATION" | "ENVIRONMENT" | "CONNECTOR";
  initialEnvironment?: string;
}

export function ImportPolicyPanel({
  workspaceId,
  workspaceSlug,
  label = "Create policy",
  variant = "primary",
  initialScope,
  initialEnvironment,
}: ImportPolicyPanelProps) {
  const t = useTranslations("import_policy_panel");

  return (
    <SlideOutPanel
      description={t("new_branch.description")}
      eyebrow={t("new_branch.eyebrow")}
      title={t("new_branch.title")}
      width="wide"
      trigger={({ open, triggerId }) => (
        <button className={variant === "primary" ? "button buttonPrimary" : "button buttonSmall"} id={triggerId} onClick={open} type="button">
          <GitBranch size={16} />
          {label}
        </button>
      )}
    >
      <ImportForm workspaceId={workspaceId} workspaceSlug={workspaceSlug} initialScope={initialScope} initialEnvironment={initialEnvironment} />
    </SlideOutPanel>
  );
}
