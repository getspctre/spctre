import { canUseDemoFallbackData } from "@/lib/demo-guard";
import {
  audits,
  branches,
  mockHeatmap,
  mockUnusedRules,
  rules,
  simulationRun,
} from "@/lib/mock-data";
import type { AgentSummary } from "@/lib/repositories/evidence";
import type { RuleHeatEntry, UnusedRule } from "@/lib/repositories/policy";
import type {
  PolicyBranch,
  PolicyRuleSummary,
  RuntimeDecisionEvidenceRecord,
  SimulationRun,
} from "@spctre/policy-schema";

export function getPolicyDemoFallbackData(tenantId: string): {
  branches: PolicyBranch[];
  rules: PolicyRuleSummary[];
} {
  if (!canUseDemoFallbackData(tenantId)) {
    return { branches: [], rules: [] };
  }
  return { branches, rules };
}

export function getEvidenceDemoFallbackData(tenantId: string): {
  evidence: RuntimeDecisionEvidenceRecord[];
  heatmap: RuleHeatEntry[];
  unusedRules: UnusedRule[];
  simulationRun: SimulationRun | null;
} {
  if (!canUseDemoFallbackData(tenantId)) {
    return { evidence: [], heatmap: [], unusedRules: [], simulationRun: null };
  }
  return { evidence: audits, heatmap: mockHeatmap, unusedRules: mockUnusedRules, simulationRun };
}

export function getAgentDemoFallbackData(tenantId: string): AgentSummary[] {
  if (!canUseDemoFallbackData(tenantId)) return [];

  return [
    {
      agentId: "support-agent-7",
      environment: "production",
      runtimeStack: "AWS_BEDROCK",
      runtimeAdapter: "agt-compatible-bedrock",
      currentArtifactHash: "sha256:a1b2c3d4e5f6",
      latestPublishedHash: "sha256:a1b2c3d4e5f6",
      healthStatus: "CURRENT",
      allowCount: 142,
      denyCount: 23,
      warnCount: 8,
      totalDecisions: 173,
      connectors: ["stripe", "zendesk"],
      lastSeen: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    },
    {
      agentId: "billing-agent-2",
      environment: "production",
      runtimeStack: "LANGCHAIN",
      runtimeAdapter: "agt-langchain-adapter",
      currentArtifactHash: "sha256:9f8e7d6c5b4a",
      latestPublishedHash: "sha256:a1b2c3d4e5f6",
      healthStatus: "OUTDATED",
      allowCount: 89,
      denyCount: 41,
      warnCount: 14,
      totalDecisions: 144,
      connectors: ["stripe"],
      lastSeen: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    },
    {
      agentId: "crm-agent-1",
      environment: "staging",
      runtimeStack: "OPENAI_AGENTS",
      runtimeAdapter: undefined,
      currentArtifactHash: "sha256:a1b2c3d4e5f6",
      latestPublishedHash: "sha256:a1b2c3d4e5f6",
      healthStatus: "CURRENT",
      allowCount: 34,
      denyCount: 5,
      warnCount: 3,
      totalDecisions: 42,
      connectors: ["salesforce"],
      lastSeen: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
    },
    {
      agentId: "deploy-agent-3",
      environment: "production",
      runtimeStack: "CREWAI",
      runtimeAdapter: undefined,
      currentArtifactHash: "sha256:1a2b3c4d5e6f",
      latestPublishedHash: "sha256:a1b2c3d4e5f6",
      healthStatus: "STALE",
      allowCount: 201,
      denyCount: 67,
      warnCount: 19,
      totalDecisions: 287,
      connectors: ["github"],
      lastSeen: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
  ];
}
