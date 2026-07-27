import { vi } from "vitest";
import { handleValidationSelect } from "./sql-mock-helper";

const DEMO_TOKEN = "demo-token-for-tests";

export type EvidenceSource = "mcp" | "hook";
export type InsertResultResolver = () => unknown[];

export function makeEvidenceSqlMock(resolveInsertResult: InsertResultResolver) {
  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.from(strings).join("").replace(/\s+/g, " ").trim().toUpperCase();
    if (joined.startsWith("INSERT")) {
      return Promise.resolve(resolveInsertResult());
    }
    const valResult = handleValidationSelect(joined, args);
    if (valResult) {
      return Promise.resolve(valResult);
    }
    return Promise.resolve([{ id: "row-exists", decision_id: "dec-1" }]);
  };
  return Object.assign(fn, {
    begin: vi.fn(async (callback: (tx: typeof fn) => Promise<unknown>) => callback(fn)),
  });
}

export function buildEvidenceRequest(
  overrides: Record<string, unknown> = {},
  source: EvidenceSource = "hook",
  options: { includeSourceHeader?: boolean } = {}
): Request {
  const includeSourceHeader = options.includeSourceHeader ?? true;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DEMO_TOKEN}`,
  };
  if (includeSourceHeader) headers["x-spctre-source"] = source;

  const body = {
    decisionId: "dec-1",
    tenantId: "demo-tenant",
    workspaceId: "demo-workspace",
    environment: "production",
    runtimeTarget: { stack: "LOCAL" },
    agentId: "agent-1",
    connector: "github",
    action: "execute",
    status: "ALLOW",
    reason: "allowed",
    policyRefs: ["rule-1"],
    artifactHash: "sha256:abc",
    policyContext: [{ scope: "WORKSPACE", branchId: "b-1", revisionId: "r-1", artifactHash: "sha256:abc" }],
    latencyMs: 5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };

  return new Request("http://localhost:3000/api/evidence", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export function findDedupTelemetry(consoleSpy: { mock: { calls: unknown[][] } }): Record<string, unknown> | undefined {
  return consoleSpy.mock.calls
    .map(([msg]) => {
      try {
        return JSON.parse(msg as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find((obj) => obj?.message === "evidence.dedup_suppressed") ?? undefined;
}
