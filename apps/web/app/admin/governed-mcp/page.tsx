import { Boxes } from "lucide-react";
import { redirect } from "next/navigation";
import { SettingsHeader } from "@/components/settings-header";
import { findActorById } from "@/lib/actors";
import { getAuthSession } from "@/lib/auth-session";
import {
  listGovernedMcpConnectors,
  listMcpToolRegistry,
  type McpToolRegistryEntry,
} from "@/lib/domains/mcp/service";
import { swallow } from "@/lib/platform/swallow";
import { getActiveScope } from "@/lib/workspace";
import { formatAdminDate } from "../format";
import { GrantToolForm, RegisterToolForm, RevokeGrantForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function AdminGovernedMcpPage() {
  const scope = await getActiveScope();
  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (!session) redirect("/login");

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  }).catch(swallow("findActorById", null));
  if (!actor?.reviewerRoles.includes("Admin")) redirect("/?error=admin-required");

  const tools: McpToolRegistryEntry[] = await listMcpToolRegistry({
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  }).catch(swallow("listMcpToolRegistry", [] as McpToolRegistryEntry[]));

  const connectors = await listGovernedMcpConnectors({
    tenantId: session.tenantId,
    workspaceId: scope.workspaceId,
  }).catch(swallow("listGovernedMcpConnectors", [] as string[]));

  const grantedCount = tools.reduce((total, tool) => total + tool.grants.length, 0);

  return (
    <>
      <SettingsHeader
        eyebrow="Governed MCP"
        title="MCP tool registry"
        description="Which MCP tools this workspace's agents may call. A tool that is registered but not granted is denied, and every change here is recorded in the operations log."
        actions={
          <span className="pill pillNeutral">
            {tools.length} registered · {grantedCount} granted
          </span>
        }
      />

      <div className="adminAuthLayout">
        <section className="adminAuthStack" aria-label="Registered MCP tools">
          <section className="adminAuthPanel" aria-labelledby="registry-heading">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">Registry</p>
                <h2 id="registry-heading">Registered tools</h2>
              </div>
              <Boxes size={18} aria-hidden />
            </div>

            {tools.length === 0 ? (
              <div className="emptyState">
                <h3>No tools registered</h3>
                <p className="meta">
                  Until a tool is registered and granted, <code>authorize_mcp_tool_call</code>{" "}
                  answers DENY for everything except Spctre&apos;s own governance tools. That is the
                  registry working, not a misconfiguration — but it means agents can call nothing.
                </p>
              </div>
            ) : (
              <ul className="adminList">
                {tools.map((tool) => (
                  <li key={tool.id} className="adminListItem">
                    <div className="rowHeader">
                      <div>
                        <h3>
                          <code>
                            {tool.serverName}.{tool.toolName}
                          </code>
                        </h3>
                        <p className="meta">
                          {tool.connector} · {tool.action}
                          {tool.description ? ` — ${tool.description}` : ""}
                        </p>
                        <p className="meta">Registered {formatAdminDate(tool.createdAt)}</p>
                      </div>
                      <span
                        className={tool.status === "ACTIVE" ? "pill pillAllow" : "pill pillNeutral"}
                      >
                        {tool.status}
                      </span>
                    </div>

                    {tool.grants.length === 0 ? (
                      <p className="meta">
                        No grants — every call for this tool is denied in this workspace.
                      </p>
                    ) : (
                      <ul className="adminList">
                        {tool.grants.map((grant) => {
                          const label = `${tool.serverName}.${tool.toolName} for ${
                            grant.agentId ? `agent ${grant.agentId}` : "every agent"
                          } in ${grant.environment === "*" ? "every environment" : grant.environment}`;
                          return (
                            <li key={grant.id} className="adminListItem">
                              <div className="rowHeader">
                                <div>
                                  <p>
                                    {grant.agentId ? (
                                      <>
                                        Agent <code>{grant.agentId}</code>
                                      </>
                                    ) : (
                                      "Every agent in this workspace"
                                    )}
                                  </p>
                                  <p className="meta">
                                    {grant.environment === "*"
                                      ? "Every environment"
                                      : `Environment ${grant.environment}`}{" "}
                                    · granted {formatAdminDate(grant.createdAt)}
                                  </p>
                                </div>
                                <RevokeGrantForm grantId={grant.id} label={label} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <GrantToolForm
                      registryId={tool.id}
                      label={`${tool.serverName}.${tool.toolName}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>

        <section className="adminAuthStack" aria-label="Register an MCP tool">
          <section className="adminAuthPanel" aria-labelledby="register-heading">
            <div className="adminAuthPanelHeader">
              <div>
                <p className="eyebrow">Register</p>
                <h2 id="register-heading">Add a tool</h2>
              </div>
            </div>
            <RegisterToolForm connectorSuggestions={connectors} />
          </section>
        </section>
      </div>
    </>
  );
}
