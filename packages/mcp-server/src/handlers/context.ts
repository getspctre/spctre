import type { AxiosResponse } from "axios";
import type { SpctreConfig } from "../config.js";
import type { GovernedMcpCapability } from "../governance.js";

// Shared operations the tool and resource handlers need from the server. The
// SpctreMcpServer implements this seam so handlers can live in their own
// modules (handlers/tools.ts, handlers/resources.ts) without importing the
// transport bootstrap or composition wiring.
export interface McpServerContext {
  readonly config: SpctreConfig;
  getWithAuth(path: string, params?: Record<string, unknown>): Promise<AxiosResponse>;
  postWithAuth(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<AxiosResponse>;
  assertConnectorAllowed(connector: string | undefined): void;
  fetchPublishedBundleRefs(
    workspaceId: string,
  ): Promise<{ branchId: string; revisionId: string; artifactHash: string }>;
  ensureMcpPolicyLoaded(options?: { agentId?: string; environment?: string }): Promise<void>;
  readonly governedMcpCapabilities: GovernedMcpCapability[];
  readonly mcpRegistrySource: string;
}

// Narrow an unknown thrown value to a human-readable message for tool/resource
// error envelopes without assuming it is an Error instance.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
