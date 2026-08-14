import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import type { SpctreConfig } from "../src/config.js";
import type { McpServerContext } from "../src/handlers/context.js";
import {
  getAgentAuditResource,
  getApprovalsQueueResource,
  getApprovalsResource,
  getEvidenceResource,
  getIdentityEventsResource,
  getMembersListResource,
  getPoliciesResource,
  getTrustHistoryResource,
  getVerificationResultsResource,
  getWorkflowConfigResource,
  getWorkspacesListResource,
} from "../src/handlers/resources.js";
import {
  authorizeMcpToolCall,
  createEvidenceRecord,
  discoverMcpTools,
  escalateToReview,
  evaluatePolicy,
  getComplianceStatus,
  getEffectivePolicy,
  getPolicyStatus,
  ingestGatewayEvent,
  listPendingEscalations,
} from "../src/handlers/tools.js";

// What this server needs from the control plane, captured by running the
// handlers rather than by reading them.
//
// The paths are built from template literals and conditional branches, so a
// regex over the source misses them — that is not hypothetical: two dependencies
// (`/api/agents/<id>/audit` and `/api/approvals/<id>`) were missed exactly that
// way, and were found only when a request failed in staging. Every path here is
// the string the handler actually passed to getWithAuth/postWithAuth.
//
// The captured set is compared against control-plane-dependencies.json, which
// apps/web reads to assert the other half of the contract: that each path is
// implemented, carries the expected scope, and is reachable past both proxy
// gates. Adding a dependency therefore fails here until it is declared, and
// fails there until the control plane can actually serve it.

const MANIFEST_PATH = join(__dirname, "..", "control-plane-dependencies.json");

interface Call {
  method: "GET" | "POST";
  path: string;
}

const config: SpctreConfig = {
  apiBaseUrl: "http://control-plane.test",
  apiToken: "test-token",
  workspaceId: "ws-test",
  agentId: "agent-test",
  transport: "stdio",
  httpPort: 8090,
  httpPath: "/mcp",
  requireBearerAuth: true,
  httpRateLimitPerSecond: 25,
  httpRateLimitBurst: 50,
};

function axiosResponse(data: unknown): AxiosResponse {
  return {
    data,
    headers: {},
    status: 200,
    statusText: "OK",
    config: {},
  } as unknown as AxiosResponse;
}

/**
 * Answers every call with a shape permissive enough that handlers continue past
 * it. A handler that still throws is fine — the call was recorded first — but a
 * handler that throws *before* calling is not, which is what the per-handler
 * assertion below catches.
 */
function recordingContext(calls: Call[]): McpServerContext {
  const body = {
    decision: {},
    decisions: [],
    evidence: [],
    records: [],
    items: [],
    escalations: [],
    approvals: [],
    members: [],
    workspaces: [],
    events: [],
    history: [],
    results: [],
    adapters: [],
    capabilities: [],
    bundle: { policies: [], rules: [] },
    policies: [],
    rules: [],
    branchId: "b1",
    revisionId: "r1",
    artifactHash: "h1",
    meta: { traceId: "t1" },
  };
  return {
    config,
    getWithAuth: async (path: string) => {
      calls.push({ method: "GET", path });
      return axiosResponse(body);
    },
    postWithAuth: async (path: string) => {
      calls.push({ method: "POST", path });
      return axiosResponse(body);
    },
    assertConnectorAllowed: () => {},
    fetchPublishedBundleRefs: async () => ({
      branchId: "b1",
      revisionId: "r1",
      artifactHash: "h1",
    }),
    ensureMcpPolicyLoaded: async () => {},
    governedMcpCapabilities: [],
    mcpRegistrySource: "api",
  };
}

const AGENT_CONTEXT = { agent_id: "agent-test", workspace_id: "ws-test" };

type Invocation = {
  name: string;
  run: (ctx: McpServerContext) => Promise<unknown>;
  /** Handlers that answer from local state and legitimately call nothing. */
  callsControlPlane?: false;
};

const INVOCATIONS: Invocation[] = [
  // Resources, with URIs matching the prefixes server.ts dispatches on.
  { name: "policies", run: (c) => getPoliciesResource(c, "spctre://policies/current") },
  { name: "evidence", run: (c) => getEvidenceResource(c, "spctre://evidence/dec-1") },
  { name: "approvals/queue", run: (c) => getApprovalsQueueResource(c, "spctre://approvals/queue") },
  { name: "approvals/<id>", run: (c) => getApprovalsResource(c, "spctre://approvals/apr-1") },
  {
    name: "agents/<id>/audit",
    run: (c) => getAgentAuditResource(c, "spctre://agents/scout/audit"),
  },
  { name: "trust", run: (c) => getTrustHistoryResource(c, "spctre://trust/scout") },
  { name: "identity", run: (c) => getIdentityEventsResource(c, "spctre://identity/scout") },
  {
    name: "verification",
    run: (c) => getVerificationResultsResource(c, "spctre://verification/latest"),
  },
  { name: "workspaces", run: (c) => getWorkspacesListResource(c, "spctre://workspaces/list") },
  { name: "workflows", run: (c) => getWorkflowConfigResource(c, "spctre://workflows/default") },
  { name: "members", run: (c) => getMembersListResource(c, "spctre://members/list") },

  // Tools, with arguments satisfying each schema's `required` list. Anything
  // less and the handler answers with an error envelope before calling out,
  // which the silence assertion below reports rather than hides.
  {
    name: "evaluate_policy",
    run: (c) =>
      evaluatePolicy(c, { connector: "notion", action: "read", agent_context: AGENT_CONTEXT }),
  },
  {
    name: "create_evidence_record",
    run: (c) =>
      createEvidenceRecord(c, {
        decision_id: "dec-1",
        connector: "notion",
        action: "read",
        agent_context: AGENT_CONTEXT,
      }),
  },
  {
    name: "escalate_to_review",
    run: (c) => escalateToReview(c, { decision_id: "dec-1", reason: "needs review" }),
  },
  { name: "get_policy_status", run: (c) => getPolicyStatus(c, { workspace_id: "ws-test" }) },
  { name: "get_effective_policy", run: (c) => getEffectivePolicy(c, { connector: "notion" }) },
  { name: "list_pending_escalations", run: (c) => listPendingEscalations(c, {}) },
  { name: "get_compliance_status", run: (c) => getComplianceStatus(c, {}) },
  {
    name: "ingest_gateway_event",
    run: (c) =>
      ingestGatewayEvent(c, {
        provider: "notion",
        gateway_event_id: "evt-1",
        agent_id: "agent-test",
      }),
  },
  { name: "discover_mcp_tools", run: (c) => discoverMcpTools(c, {}), callsControlPlane: false },
  {
    name: "authorize_mcp_tool_call",
    run: (c) => authorizeMcpToolCall(c, { server_name: "notion", tool_name: "search" }),
    callsControlPlane: false,
  },
];

async function capture(): Promise<Map<string, Call[]>> {
  const perHandler = new Map<string, Call[]>();
  for (const invocation of INVOCATIONS) {
    const calls: Call[] = [];
    const ctx = recordingContext(calls);
    // A handler may reject on the stub's response shape; the call it made was
    // already recorded, and the assertions below are about the calls.
    await invocation.run(ctx).catch((error: unknown) => {
      if (process.env.DEBUG_CAPTURE)
        console.error("[capture]", invocation.name, "->", (error as Error)?.message);
    });
    perHandler.set(invocation.name, calls);
  }
  return perHandler;
}

/**
 * The ids above are this harness's own sample values. Replace them with a
 * placeholder so the manifest describes routes rather than fixtures, which is
 * also the form apps/web needs to resolve each one to a route file.
 */
const SAMPLE_IDS = new Set(["dec-1", "apr-1", "scout"]);

function format(call: Call): string {
  const path = call.path
    .split("/")
    .map((segment) => (SAMPLE_IDS.has(segment) ? "{id}" : segment))
    .join("/");
  return `${call.method} ${path}`;
}

/**
 * Two calls are issued by SpctreMcpServer itself rather than by a handler —
 * `ensureMcpPolicyLoaded` and `fetchPublishedBundleRefs` — and the recording
 * context stands in for both, so the capture above cannot see them. Leaving
 * them out would exclude `/api/workspace/mcp-policy`, the endpoint whose
 * absence from the proxy path sets started all of this.
 *
 * They are read from the source instead, which is sound here for the reason it
 * is not sound for handlers: the server passes literal strings, not templates.
 */
function serverIssuedCalls(): Call[] {
  const source = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
  const matches = [...source.matchAll(/this\.(get|post)WithAuth\(\s*"([^"]+)"/g)];
  return matches.map((match) => ({ method: match[1] === "get" ? "GET" : "POST", path: match[2] }));
}

describe("control-plane dependencies", () => {
  it("reaches the control plane from every handler that is supposed to", async () => {
    // Guards the capture itself. A handler that threw on its arguments before
    // issuing a request would contribute nothing, and an empty contribution is
    // indistinguishable from a handler that needs nothing — so say which is
    // which, rather than letting silence pass for success.
    const perHandler = await capture();
    const silent = INVOCATIONS.filter(
      (invocation) =>
        invocation.callsControlPlane !== false && perHandler.get(invocation.name)?.length === 0,
    ).map((invocation) => invocation.name);

    expect(silent).toEqual([]);
  });

  it("still finds the calls the server issues directly", () => {
    // The scan is a regex over source, so it fails open if that source stops
    // matching. Assert it found something recognisable rather than trusting it.
    const paths = serverIssuedCalls().map((call) => call.path);

    expect(paths).toContain("/api/workspace/mcp-policy");
    expect(paths).toContain("/api/bundle/latest");
  });

  it("matches the declared dependency manifest", async () => {
    const perHandler = await capture();
    const captured = [
      ...new Set([...[...perHandler.values()].flat(), ...serverIssuedCalls()].map(format)),
    ].sort();

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      dependencies: Array<{ method: "GET" | "POST"; path: string; scope: string }>;
    };
    const declared = [...new Set(manifest.dependencies.map(format))].sort();

    // Drift in either direction is a finding: a new call the control plane has
    // not been checked against, or a declaration no handler makes any more.
    expect(captured).toEqual(declared);
  });

  it("declares a scope for every dependency", async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      dependencies: Array<{ method: string; path: string; scope: string }>;
    };
    const missing = manifest.dependencies
      .filter((dependency) => !/^[a-z]+:[a-z]+$/.test(dependency.scope ?? ""))
      .map((dependency) => dependency.path);

    expect(missing).toEqual([]);
  });
});
