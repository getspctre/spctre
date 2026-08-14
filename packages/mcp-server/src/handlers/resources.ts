// MCP resource handlers. Each reads upstream control-plane data and returns an
// MCP resource contents envelope. Extracted from server.ts (Phase 2 large-file
// split); the ReadResource dispatch stays in server.ts.

import { errorMessage, type McpServerContext } from "./context.js";

export async function getPoliciesResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const response = await ctx.getWithAuth("/api/bundle/latest", {
    workspace_id: ctx.config.workspaceId,
  });

  const headers = response.headers ?? {};
  const revisionId = headers["x-spctre-revision-id"] ?? null;
  const artifactHash = headers["x-spctre-artifact-hash"] ?? null;
  const branchId = headers["x-spctre-branch-id"] ?? "main";
  const publishedAt = headers["x-spctre-published-at"] ?? new Date().toISOString();

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          branch_id: branchId,
          revision_id: revisionId,
          artifact_hash: artifactHash,
          policies: response.data?.policies || [],
          last_updated_at: publishedAt,
          updated_by: "system",
          approval_status: revisionId ? "PUBLISHED" : "UNAVAILABLE",
          published: !!revisionId,
        }),
      },
    ],
  };
}

/**
 * Turns an id read from a resource URI into one path segment.
 *
 * The segment arrives percent-encoded, because that is how it was written into
 * the URI, and the control-plane path needs it percent-encoded too — so
 * encoding what was read would encode the escapes themselves and `%2F` would
 * travel as `%252F`, a different id that matches no record. Decode once, then
 * encode once.
 *
 * A segment whose escapes are malformed cannot be decoded at all. That is not a
 * reason to throw: it is an id that happens to contain a `%`, so it is encoded
 * as the literal it is.
 */
export function resourceIdValue(segment: string | undefined): string {
  if (!segment) return "";
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed escapes are not decodable; the segment is an id that contains
    // a percent sign, so it is already its own value.
    return segment;
  }
}

export function resourceIdToPathSegment(segment: string | undefined): string {
  return encodeURIComponent(resourceIdValue(segment));
}

export async function getEvidenceResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const decisionId = uri.split("/").pop();
  const response = await ctx.getWithAuth(`/api/evidence/${resourceIdToPathSegment(decisionId)}`);

  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }] };
}

export async function getApprovalsResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const approvalId = uri.split("/").pop();

  try {
    const response = await ctx.getWithAuth(`/api/approvals/${resourceIdToPathSegment(approvalId)}`);
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(response.data.approval ?? response.data),
        },
      ],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: `Approval lookup failed: ${errorMessage(error)}`,
            approval_id: approvalId,
          }),
        },
      ],
    };
  }
}

export async function getAgentAuditResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // `spctre://agents/<agent-id>/audit` has the authority (`agents`) in the
  // URI host, so split("/")[2] is always "agents", not the requested ID.
  const agentId = new URL(uri).pathname.split("/").filter(Boolean)[0];
  if (!agentId) throw new Error(`Agent audit resource is missing an agent ID: ${uri}`);
  const response = await ctx.getWithAuth(`/api/agents/${resourceIdToPathSegment(agentId)}/audit`, {
    workspace_id: ctx.config.workspaceId,
  });

  const data = response.data ?? {};
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          agent_id: agentId,
          workspace_id: ctx.config.workspaceId,
          decisions: data.decisions || [],
          summary: {
            decisions_allowed: data.summary?.decisionsAllowed ?? 0,
            decisions_blocked: data.summary?.decisionsBlocked ?? 0,
            decisions_warned: data.summary?.decisionsWarned ?? 0,
            decisions_escalated: data.summary?.decisionsEscalated ?? 0,
            compliance_status: data.summary?.complianceStatus ?? "UNKNOWN",
          },
          generated_at: data.generatedAt ?? new Date().toISOString(),
        }),
      },
    ],
  };
}

export async function getTrustHistoryResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // URI: spctre://trust/{agent_id}/history
  const parts = uri.replace("spctre://trust/", "").split("/");
  const agentId = parts[0];

  try {
    const response = await ctx.getWithAuth("/api/trust/history", {
      agentId: resourceIdValue(agentId),
      workspace_id: ctx.config.workspaceId,
    });
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: `Trust history unavailable: ${errorMessage(error)}`,
            agentId,
          }),
        },
      ],
    };
  }
}

export async function getIdentityEventsResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // URI: spctre://identity/{principal_id}/events
  const parts = uri.replace("spctre://identity/", "").split("/");
  const principalId = parts[0];

  try {
    const response = await ctx.getWithAuth("/api/identity/events", {
      principalId: resourceIdValue(principalId),
      workspace_id: ctx.config.workspaceId,
    });
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: `Identity events unavailable: ${errorMessage(error)}`,
            principalId,
          }),
        },
      ],
    };
  }
}

export async function getVerificationResultsResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    const response = await ctx.getWithAuth("/api/verification", {
      workspace_id: ctx.config.workspaceId,
    });
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: `Verification results unavailable: ${errorMessage(error)}`,
          }),
        },
      ],
    };
  }
}

export async function getWorkspacesListResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    const response = await ctx.getWithAuth("/api/workspaces");
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: `Workspace list unavailable: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function getApprovalsQueueResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    const response = await ctx.getWithAuth("/api/approvals/queue");
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: `Approval queue unavailable: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function getWorkflowConfigResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    const response = await ctx.getWithAuth("/api/workflow/config", {
      workspace_id: ctx.config.workspaceId,
    });
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: `Workflow config unavailable: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}

export async function getMembersListResource(
  ctx: McpServerContext,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    const response = await ctx.getWithAuth("/api/members");
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(response.data) }],
    };
  } catch (error: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: `Member list unavailable: ${errorMessage(error)}` }),
        },
      ],
    };
  }
}
