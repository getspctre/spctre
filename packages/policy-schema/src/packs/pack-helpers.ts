import type { PolicyPackMetadata, PolicyPackChangelogEntry } from "../types";

/** Shared metadata scaffold for hand-authored high-risk connector packs. */
export function makePackMetadata(params: {
  name: string;
  connector: string;
  riskLevel: PolicyPackMetadata["riskLevel"];
  riskTags: string[];
  category: string;
  changelog: PolicyPackChangelogEntry[];
  minimumApprovals?: number;
}): Record<string, unknown> {
  const metadata: PolicyPackMetadata = {
    name: params.name,
    version: "1.0.0",
    connector: params.connector,
    author: "spctre",
    owner: "spctre-pack-security",
    riskLevel: params.riskLevel,
    riskTags: params.riskTags,
    generated: false,
    category: params.category,
    compatibilityTargets: [
      "AGT_PREVIEW",
      "OPENAI_AGENTS",
      "LANGCHAIN",
      "AWS_BEDROCK",
      "GOOGLE_ADK",
      "AZURE_AI",
    ],
    reviewRoles: ["SECURITY", "COMPLIANCE"],
    minimumApprovals: params.minimumApprovals ?? 2,
    changelog: params.changelog,
  };
  return { ...metadata };
}
