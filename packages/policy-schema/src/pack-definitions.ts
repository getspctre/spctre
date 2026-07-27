import type { PolicyPack } from "./types";
import {
  GATEWAY_PORTKEY_PACK,
  GATEWAY_HELICONE_PACK,
  GATEWAY_LITELLM_PACK,
  GATEWAY_NOTION_PACK,
} from "./packs/gateway";
import {
  AGENT_FABRIC_PACK,
  COPILOT_STUDIO_PACK,
  SERVICENOW_AI_CONTROL_TOWER_PACK,
  GEMINI_ENTERPRISE_AGENT_PLATFORM_PACK,
  AZURE_AI_FOUNDRY_PACK,
  AMAZON_BEDROCK_AGENTS_PACK,
  IBM_WATSONX_ORCHESTRATE_PACK,
  KORE_AI_PACK,
  NOTION_ORCHESTRATION_PACK,
} from "./packs/enterprise-orchestration";
import {
  CREWAI_GOVERNANCE_PACK,
  LANGCHAIN_GOVERNANCE_PACK,
  OPENAI_AGENTS_GOVERNANCE_PACK,
  AUTOGEN_GOVERNANCE_PACK,
  GOOGLE_ADK_GOVERNANCE_PACK,
  STRANDS_GOVERNANCE_PACK,
  GOOGLE_ANTIGRAVITY_GOVERNANCE_PACK,
  CLAUDE_AGENT_SDK_GOVERNANCE_PACK,
} from "./packs/framework";
import {
  SPCTRE_AGENT_GOVERNANCE_PACK,
  TRUST_GOVERNANCE_PACK,
} from "./packs/core";
import { ENTIRE_SESSION_AUDIT_PACK } from "./packs/entire";
import {
  STRIPE_PACK,
  STRIPE_BILLING_PACK,
  STRIPE_CONNECT_PACK,
  STRIPE_ISSUING_PACK,
} from "./packs/stripe";
import {
  POSTGRESQL_PACK,
  MONGODB_PACK,
  SNOWFLAKE_PACK,
  AWS_DYNAMODB_PACK,
} from "./packs/database";
import {
  GITHUB_PACK,
  GITHUB_ACTIONS_PACK,
  GITHUB_ENTERPRISE_ADMIN_PACK,
} from "./packs/github";
import {
  DEPLOYMENT_PACK,
  KUBERNETES_PACK,
  VERCEL_PACK,
  ARGO_CD_PACK,
} from "./packs/deploy";
import { ZENDESK_PACK, ZENDESK_SUPPORT_ADMIN_PACK } from "./packs/support";
import { packSurfaces } from "./pack-surfaces";
import type { PackSurface } from "./pack-surfaces";

export const CANONICAL_PACK_CONNECTORS = [
  "stripe",
  "github",
  "deployment",
  "postgresql",
  "zendesk",
] as const;

export type PackCatalogTier = "canonical" | "compatible";

const canonicalPackConnectors = new Set<string>(CANONICAL_PACK_CONNECTORS);

export function getPackCatalogTier(pack: PolicyPack): PackCatalogTier {
  return canonicalPackConnectors.has(pack.connector) ? "canonical" : "compatible";
}

// Generated packs are a deterministic coverage baseline for broad connector
// surfaces. The first three rules are immutable because they represent
// non-negotiable safety floors; provider-specific semantics belong in
// hand-authored packs, not in this template.
function makeGeneratedPack(surface: PackSurface): PolicyPack {
  const [primaryDomain, secondaryDomain, tertiaryDomain] = surface.domains;
  const titleSubject = surface.name.replace(" Governance Pack", "");

  return {
    id: surface.id,
    name: surface.name,
    connector: surface.connector,
    description: `Governance rules for ${titleSubject} ${surface.category} operations — prevents destructive changes, sensitive data exposure, privilege escalation, and high-impact automation without human review.`,
    riskLevel: surface.riskLevel,
    tags: surface.tags,
    domains: surface.domains,
    metadata: {
      name: surface.name,
      version: "1.0.0",
      connector: surface.connector,
      author: "spctre",
      owner: "spctre-pack-security",
      riskLevel: surface.riskLevel,
      riskTags: surface.tags.slice(0, 4),
      generated: true,
      category: surface.category,
      compatibilityTargets: [
        "AGT_PREVIEW",
        "OPENAI_AGENTS",
        "LANGCHAIN",
        "AWS_BEDROCK",
        "GOOGLE_ADK",
        "AZURE_AI",
      ],
      reviewRoles: ["SECURITY", "COMPLIANCE"],
      minimumApprovals: 2,
      changelog: [
        {
          version: "1.0.0",
          date: "2026-05-07",
          summary: "Initial governed pack baseline with destructive-change, export, privilege, and automation controls.",
        },
      ],
    },
    rules: [
      {
        stableRuleId: `${surface.connector}.destructive_change.block`,
        title: `Block destructive ${primaryDomain} changes without approval`,
        effect: "DENY",
        domains: [primaryDomain],
        connectors: [surface.connector],
        actions: [`${primaryDomain}.delete`, `${primaryDomain}.destroy`, `${primaryDomain}.purge`],
        immutable: true,
      },
      {
        stableRuleId: `${surface.connector}.sensitive_export.block`,
        title: `Block sensitive ${secondaryDomain ?? primaryDomain} exports without compliance approval`,
        effect: "DENY",
        domains: [secondaryDomain ?? primaryDomain, "exports"],
        connectors: [surface.connector],
        actions: [`${secondaryDomain ?? primaryDomain}.export`, "report.export", "data.bulk_export"],
        immutable: true,
      },
      {
        stableRuleId: `${surface.connector}.privilege_escalation.block`,
        title: `Block privilege or ownership escalation in ${titleSubject}`,
        effect: "DENY",
        domains: [tertiaryDomain ?? primaryDomain, "users"],
        connectors: [surface.connector],
        actions: ["user.role_update", "permission.grant", "owner.assign"],
        immutable: true,
      },
      {
        stableRuleId: `${surface.connector}.automation.review_warn`,
        title: `Warn on high-impact automated ${primaryDomain} operations`,
        effect: "WARN",
        domains: [primaryDomain, tertiaryDomain ?? primaryDomain],
        connectors: [surface.connector],
        actions: [`${primaryDomain}.bulk_update`, "automation.run", "workflow.execute"],
        immutable: false,
      },
    ],
  };
}

function assertUniquePackCatalog(packs: PolicyPack[]): PolicyPack[] {
  const ids = new Set<string>();
  const connectors = new Set<string>();

  for (const pack of packs) {
    if (ids.has(pack.id)) throw new Error(`Duplicate policy pack id: ${pack.id}`);
    if (connectors.has(pack.connector)) {
      throw new Error(`Duplicate policy pack connector: ${pack.connector}`);
    }
    ids.add(pack.id);
    connectors.add(pack.connector);
  }

  return packs;
}

export const POLICY_PACKS: PolicyPack[] = assertUniquePackCatalog([
  ...packSurfaces.map(makeGeneratedPack),
  GATEWAY_PORTKEY_PACK,
  GATEWAY_HELICONE_PACK,
  GATEWAY_LITELLM_PACK,
  GATEWAY_NOTION_PACK,
  AGENT_FABRIC_PACK,
  COPILOT_STUDIO_PACK,
  SERVICENOW_AI_CONTROL_TOWER_PACK,
  GEMINI_ENTERPRISE_AGENT_PLATFORM_PACK,
  AZURE_AI_FOUNDRY_PACK,
  AMAZON_BEDROCK_AGENTS_PACK,
  IBM_WATSONX_ORCHESTRATE_PACK,
  KORE_AI_PACK,
  SPCTRE_AGENT_GOVERNANCE_PACK,
  CREWAI_GOVERNANCE_PACK,
  LANGCHAIN_GOVERNANCE_PACK,
  OPENAI_AGENTS_GOVERNANCE_PACK,
  AUTOGEN_GOVERNANCE_PACK,
  GOOGLE_ADK_GOVERNANCE_PACK,
  STRANDS_GOVERNANCE_PACK,
  GOOGLE_ANTIGRAVITY_GOVERNANCE_PACK,
  CLAUDE_AGENT_SDK_GOVERNANCE_PACK,
  TRUST_GOVERNANCE_PACK,
  NOTION_ORCHESTRATION_PACK,
  ENTIRE_SESSION_AUDIT_PACK,
  STRIPE_PACK,
  STRIPE_BILLING_PACK,
  STRIPE_CONNECT_PACK,
  STRIPE_ISSUING_PACK,
  POSTGRESQL_PACK,
  MONGODB_PACK,
  SNOWFLAKE_PACK,
  AWS_DYNAMODB_PACK,
  GITHUB_PACK,
  GITHUB_ACTIONS_PACK,
  GITHUB_ENTERPRISE_ADMIN_PACK,
  DEPLOYMENT_PACK,
  KUBERNETES_PACK,
  VERCEL_PACK,
  ARGO_CD_PACK,
  ZENDESK_PACK,
  ZENDESK_SUPPORT_ADMIN_PACK,
]);
