import type { SupportedLocale } from "@/lib/i18n/messages";

export const terminologyOptions = [
  {
    id: "organization",
    label: "Organization",
    description: "Membership, roles, and organization-level settings.",
    sourceTerms: { en: "Organization", de: "Organisation", fr: "organisation", ja: "組織" },
    keys: [
      "admin.auth.eyebrow",
      "admin.members.eyebrow",
      "admin.members.title",
      "admin.members.role_matrix.eyebrow",
      "admin.members.invite_form.organization_role",
      "admin.members.inspector.organization_role",
      "admin.workspace.language.eyebrow",
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Workspace management and access labels.",
    sourceTerms: { en: "Workspace", de: "Workspace", fr: "workspace", ja: "ワークスペース" },
    keys: [
      "policies.workspace_policy",
      "admin.members.inspector.workspace",
      "admin.members.inspector.workspace_access",
      "admin.workspace.aria_label",
      "admin.workspace.eyebrow",
      "admin.workspace.title",
    ],
  },
] as const;

export function getTerminologyOption(id: string) {
  return terminologyOptions.find((option) => option.id === id);
}

export function sourceTermForLocale(
  option: (typeof terminologyOptions)[number],
  locale: SupportedLocale,
): string {
  return option.sourceTerms[locale];
}
