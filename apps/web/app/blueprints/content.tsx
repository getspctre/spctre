import Link from "next/link";
import { Bot, FileCode2, Plus, ShieldCheck } from "lucide-react";
import { getWorkspaceContext } from "@/lib/workspace";
import { listAgentBlueprints } from "@/lib/repositories/agent-blueprints";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { hashToFingerprint } from "@/lib/fingerprint";

export async function BlueprintsPageContent({ workspaceSlug }: { workspaceSlug?: string }) {
  const workspace = await getWorkspaceContext({ workspaceSlug });
  const blueprints = await listAgentBlueprints({ tenantId: workspace.tenantId, workspaceId: workspace.workspaceId });
  const path = (suffix: string) => workspace.workspaceSlug ? buildWorkspacePath(workspace.workspaceSlug, suffix) : suffix;
  return <>
    <section className="topbar"><div><p className="eyebrow">{formatWorkspaceEyebrow(workspace)}</p><h1>Blueprints</h1></div><div className="toolbar"><span className="pill pillNeutral">{blueprints.length} governed agents</span><Link className="button buttonPrimary" href={path("/blueprints/new")}><Plus size={16}/>New Blueprint</Link></div></section>
    <section className="blueprintsHero" aria-label="Blueprint governance">
      <div className="blueprintsHeroMain"><p className="eyebrow">Agent operating envelopes</p><h2>Review intent before runtime action.</h2><p className="meta">Each Blueprint binds an agent’s permitted tasks, tools, connectors, budgets, approvals, runtime targets, and policy revision into one immutable review path.</p></div>
      <div className="blueprintsHeroStats" aria-label="Blueprint status summary"><div><span className="meta">Published</span><strong>{blueprints.filter((b) => b.status === "PUBLISHED").length}</strong></div><div><span className="meta">In review</span><strong>{blueprints.filter((b) => b.status === "IN_REVIEW").length}</strong></div><div><span className="meta">Drafts</span><strong>{blueprints.filter((b) => b.status === "DRAFT").length}</strong></div></div>
    </section>
    <section className="panel blueprintsPanel"><div className="rowHeader"><div><p className="eyebrow">Revision ledger</p><h2>Governed agent definitions</h2><p className="meta">Inspect each definition, its lifecycle state, and the policy revision it governs.</p></div></div>
      {blueprints.length === 0 ? <div className="emptyState"><Bot size={20} className="sectionIcon"/><h3>No Blueprints yet</h3><p className="meta">Declare the first agent operating envelope, then submit its immutable draft for review and runtime provenance.</p><Link className="button buttonPrimary emptyStateAction" href={path("/blueprints/new")}><Plus size={16}/>New Blueprint</Link></div> :
      <div className="auditTableWrapper"><table className="auditTable"><thead><tr><th>Blueprint</th><th>Agent</th><th>Lifecycle</th><th>Policy revision</th><th>Active revision</th><th /></tr></thead><tbody>{blueprints.map((blueprint) => <tr className="auditRow" key={blueprint.id}><td><strong>{blueprint.name}</strong><div className="auditHash">Updated {new Date(blueprint.updatedAt).toLocaleString()}</div></td><td><code className="smallCode">{blueprint.agentId}</code></td><td><span className={`pill ${blueprint.status === "PUBLISHED" ? "pillAllow" : blueprint.status === "IN_REVIEW" ? "pillWarn" : "pillNeutral"}`}>{blueprint.status.replace("_", " ")}</span></td><td>{blueprint.policyRevisionId ? <code className="smallCode">{hashToFingerprint(blueprint.policyRevisionId)}</code> : <span className="meta">Unbound</span>}</td><td><code className="smallCode">{hashToFingerprint(blueprint.activeRevisionId)}</code></td><td><Link className="button buttonSmall" href={path(`/blueprints/${encodeURIComponent(blueprint.id)}`)}><FileCode2 size={14}/>Inspect</Link></td></tr>)}</tbody></table></div>}
    </section>
    <section className="panel blueprintsPanel"><div className="rowHeader"><div><p className="eyebrow">Runtime contract</p><h2>Published outputs</h2><p className="meta">Published Blueprints compile to <code>spctre.agent-blueprint.v1</code>. Gateway decisions bind the matching agent and policy revision, then abort undeclared connector or tool actions.</p></div><ShieldCheck size={20} className="sectionIcon" /></div></section>
  </>;
}
