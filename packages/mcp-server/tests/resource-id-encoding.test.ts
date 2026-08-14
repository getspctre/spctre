import type { AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import type { SpctreConfig } from "../src/config.js";
import type { McpServerContext } from "../src/handlers/context.js";
import {
  getAgentAuditResource,
  getApprovalsResource,
  getEvidenceResource,
  resourceIdToPathSegment,
} from "../src/handlers/resources.js";

// Ids reach these handlers percent-encoded, because that is how they were
// written into the resource URI, and leave percent-encoded, because that is
// what a path segment requires. Doing only the second half turns `%2F` into
// `%252F` — a different id, matching no record, failing as an ordinary 404.

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

function contextRecording(paths: string[]): McpServerContext {
  const respond = async (path: string): Promise<AxiosResponse> => {
    paths.push(path);
    return {
      data: { decisions: [], approval: {}, summary: {} },
      headers: {},
      status: 200,
      statusText: "OK",
      config: {},
    } as unknown as AxiosResponse;
  };
  return {
    config,
    getWithAuth: (path: string) => respond(path),
    postWithAuth: (path: string) => respond(path),
    assertConnectorAllowed: () => {},
    fetchPublishedBundleRefs: async () => ({ branchId: "b", revisionId: "r", artifactHash: "h" }),
    ensureMcpPolicyLoaded: async () => {},
    governedMcpCapabilities: [],
    mcpRegistrySource: "api",
  };
}

describe("resourceIdToPathSegment", () => {
  it("round-trips an id, rather than encoding the encoding", () => {
    // The input is already a URI segment. Encoding it as read would escape the
    // percent signs and change the id.
    expect(resourceIdToPathSegment("decision%2Fwith%2Fslashes")).toBe("decision%2Fwith%2Fslashes");
    expect(resourceIdToPathSegment("has%3Fquestion")).toBe("has%3Fquestion");
    expect(resourceIdToPathSegment("has%23hash")).toBe("has%23hash");
  });

  it("encodes an id that arrives unencoded", () => {
    expect(resourceIdToPathSegment("urn:spctre:decision:1")).toBe("urn%3Aspctre%3Adecision%3A1");
    expect(resourceIdToPathSegment("plain-id")).toBe("plain-id");
  });

  it("treats a malformed escape as a literal percent", () => {
    // "%ZZ" cannot be decoded. It is an id containing a percent sign, not an
    // error: encode it as the literal it is rather than throwing.
    expect(resourceIdToPathSegment("100%ZZ")).toBe("100%25ZZ");
    expect(resourceIdToPathSegment("%")).toBe("%25");
  });

  it("is stable under repetition", () => {
    // Decoding once and encoding once is idempotent; decode-less encoding is
    // not, which is the defect this guards.
    const once = resourceIdToPathSegment("decision%2Fwith%2Fslashes");
    expect(resourceIdToPathSegment(once)).toBe(once);
  });

  it("handles an absent segment", () => {
    expect(resourceIdToPathSegment(undefined)).toBe("");
    expect(resourceIdToPathSegment("")).toBe("");
  });
});

describe("resource handlers preserve the id they were given", () => {
  it("asks for the evidence record the URI names", async () => {
    const paths: string[] = [];
    await getEvidenceResource(
      contextRecording(paths),
      "spctre://evidence/decision%2Fwith%2Fslashes",
    );

    expect(paths).toEqual(["/api/evidence/decision%2Fwith%2Fslashes"]);
  });

  it("carries ? and # through as part of the id", async () => {
    const paths: string[] = [];
    await getEvidenceResource(contextRecording(paths), "spctre://evidence/has%3Fq%23h");

    // Unescaped, these would end the path and start a query or fragment.
    expect(paths).toEqual(["/api/evidence/has%3Fq%23h"]);
  });

  it("asks for the approval the URI names", async () => {
    const paths: string[] = [];
    await getApprovalsResource(contextRecording(paths), "spctre://approvals/apr%2F1");

    expect(paths).toEqual(["/api/approvals/apr%2F1"]);
  });

  it("asks for the agent the URI names", async () => {
    const paths: string[] = [];
    await getAgentAuditResource(contextRecording(paths), "spctre://agents/scout%2Fone/audit");

    expect(paths).toEqual(["/api/agents/scout%2Fone/audit"]);
  });
});
