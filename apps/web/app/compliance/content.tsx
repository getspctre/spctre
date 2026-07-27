import { getCompliancePageModel } from "@/lib/domains/compliance/service";
import { getPostureModel } from "@/lib/domains/posture/service";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { CompliancePresenter } from "./compliance-presenter";

type ComplianceSearchParams = Record<string, string | string[] | undefined>;
type RetentionTab = "rules" | "decisions";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getRetentionTab(params: ComplianceSearchParams): RetentionTab {
  return firstParam(params.retentionTab) === "decisions" ? "decisions" : "rules";
}

function buildRetentionHref(path: string, params: ComplianceSearchParams, tab: RetentionTab): string {
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "retentionTab" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) urlParams.append(key, item);
    } else {
      urlParams.set(key, value);
    }
  }
  if (tab === "decisions") urlParams.set("retentionTab", tab);
  const query = urlParams.toString();
  return `${path}${query ? `?${query}` : ""}#retention`;
}

export async function CompliancePageContent({
  workspaceSlug,
  searchParams = Promise.resolve({}),
}: {
  workspaceSlug?: string;
  searchParams?: Promise<ComplianceSearchParams>;
} = {}) {
  const params = await searchParams;
  const model = await getCompliancePageModel({ workspaceSlug, loadPosture: getPostureModel });
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: model.workspaceContext.tenantId,
    workspaceId: model.workspaceContext.workspaceId,
  });
  const path = `/${model.workspaceContext.workspaceSlug}/compliance`;
  return (
    <CompliancePresenter
      model={model}
      onboardingStatus={onboardingStatus}
      controlPlaneUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev"}
      retentionTab={getRetentionTab(params)}
      retentionRulesHref={buildRetentionHref(path, params, "rules")}
      retentionDecisionsHref={buildRetentionHref(path, params, "decisions")}
    />
  );
}
