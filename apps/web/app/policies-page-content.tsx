import Link from "next/link";
import { getPoliciesPageModel } from "@/lib/domains/policy/service";
import { ImportPolicyPanel } from "./import-policy-panel";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { mapEnvironmentBranches } from "@/lib/policy-targets";
import { BranchTable } from "./branch-inspector";
import { formatProvenanceId } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { DegradedDataNotice } from "./degraded-data-notice";

type PoliciesSearchParams = Record<string, string | string[] | undefined>;
const RULE_PREVIEW_LIMIT = 4;

type PoliciesModel = Awaited<ReturnType<typeof getPoliciesPageModel>>;

function branchAnchor(branchId: string) {
  return `#branch-${branchId}`;
}

function EffectivePolicySection({
  environmentMappings,
  appViewMode,
  workspaceId,
  workspaceSlug,
}: {
  environmentMappings: ReturnType<typeof mapEnvironmentBranches>;
  appViewMode: PoliciesModel["appViewMode"];
  workspaceId: string;
  workspaceSlug: string;
}) {
  return (
    <section className="panel policiesPanel" id="effective-policy">
      <div className="rowHeader">
        <div>
          <h2>Effective policy</h2>
          <p className="meta">Organization baseline <span aria-hidden="true">→</span> Workspace policy <span aria-hidden="true">→</span> Environment or connector policy <span aria-hidden="true">→</span> Enforced rules</p>
        </div>
        <a className="button buttonSmall" href="/help-docs/ui-guides/policy-creator/creating-a-branch" target="_blank" rel="noreferrer">Learn precedence</a>
      </div>
      <div className="effectivePolicyList">
        {environmentMappings.map(({ environment, branch }) => (
          <article className="effectivePolicyRow" key={environment.id}>
            <div>
              <p className="eyebrow">{environment.label}</p>
              <p className="meta">{environment.description}</p>
            </div>
            <div className="effectivePolicyStatus">
              {branch ? (
                <>
                  <strong>{branch.name}</strong>
                  <span className="meta">Environment policy is active at {formatProvenanceId(branch.activeRevision, appViewMode, 12, hashToFingerprint)}.</span>
                </>
              ) : (
                <>
                  <strong>No environment-specific policy</strong>
                  <span className="meta">{environment.label} uses the organization baseline and workspace policy above.</span>
                </>
              )}
            </div>
            <div className="effectivePolicyAction">
              {branch ? <a className="button buttonSmall" href={branchAnchor(branch.id)}>Inspect branch</a> : <ImportPolicyPanel label={`Add ${environment.label} policy`} variant="secondary" workspaceId={workspaceId} workspaceSlug={workspaceSlug} initialScope="ENVIRONMENT" initialEnvironment={environment.id} />}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function NeedsAttention({ awaitingReviewCount, missingEnvironmentPolicies, hasBranches, workspaceSlug, workspaceId }: { awaitingReviewCount: number; missingEnvironmentPolicies: number; hasBranches: boolean; workspaceSlug: string; workspaceId: string }) {
  if (!hasBranches) {
    return <section className="panel policiesAttention" aria-label="Get started with policies"><div><p className="eyebrow">Get started</p><h2>Create or install your first policy</h2><p className="meta">Policy branches are drafts. They do not affect agents until review and publish are complete.</p></div><div className="toolbar"><ImportPolicyPanel label="Create policy branch" workspaceId={workspaceId} workspaceSlug={workspaceSlug} /><a className="button" href={`/${workspaceSlug}/packs`}>Browse packs</a><a className="button" href={`/${workspaceSlug}/onboarding`}>Try a sample decision</a></div></section>;
  }
  return <section className="panel policiesAttention" aria-label="Policy work needing attention"><div><p className="eyebrow">Needs attention</p><h2>{awaitingReviewCount ? `${awaitingReviewCount} branch${awaitingReviewCount === 1 ? "" : "es"} awaiting review` : "Policy workspace is up to date"}</h2><p className="meta">{missingEnvironmentPolicies ? `${missingEnvironmentPolicies} environment${missingEnvironmentPolicies === 1 ? "" : "s"} use the shared policy with no environment-specific controls.` : "Every declared environment has a specific policy or uses the shared policy by design."}</p></div><div className="toolbar">{awaitingReviewCount ? <a className="button buttonPrimary" href={`/${workspaceSlug}/review`}>Review changes</a> : null}<a className="button" href="#effective-policy">Inspect effective policy</a></div></section>;
}

function OrgBaselineSummary({ organizationBranches }: { organizationBranches: PoliciesModel["branches"] }) {
  return (
    <section className="panel policiesPanel policyBaselineSummary" id="org-baseline">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Organization baseline</p>
          <h2>Shared controls</h2>
          <p className="meta">These branches apply across workspaces. Inspect them in the branch inventory rather than managing a second copy here.</p>
        </div>
      </div>
      <div className="policyBaselineLinks">
        {organizationBranches.length ? (
          organizationBranches.map((branch) => (
            <a href={branchAnchor(branch.id)} key={branch.id}><strong>{branch.name}</strong><span className="meta">{branch.message}</span></a>
          ))
        ) : (
          <p className="meta">No organization baseline is configured. Create a policy branch with Organization scope to add one.</p>
        )}
      </div>
    </section>
  );
}

function RulePreviewSection({
  rules,
  previewRules,
  rulesHref,
}: {
  rules: PoliciesModel["rules"];
  previewRules: PoliciesModel["rules"];
  rulesHref: string;
}) {
  return (
    <section className="panel policiesPanel" id="rules">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">Provenance · Rules</p>
          <h2>
            Active rules
            <span className="headCount">{rules.length}</span>
          </h2>
        </div>
        <Link className="button" href={rulesHref}>View all</Link>
      </div>
      {previewRules.length === 0 ? (
        <div className="emptyState">
          <h3>No managed rules yet</h3>
          <p className="meta">Import a policy or pack to start building the active rule set.</p>
        </div>
      ) : (
        <div className="auditTableWrapper">
          <table className="auditTable previewRuleTable">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Effect</th>
                <th>Connectors / Actions</th>
              </tr>
            </thead>
            <tbody>
              {previewRules.map((rule) => (
                <tr key={rule.stableRuleId} className="auditRow policiesPreviewRow">
                  <td>
                    <strong>{rule.title}</strong>
                    {rule.immutable ? (
                      <span className="pill ruleInlinePill">IMMUTABLE</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={rule.effect === "DENY" ? "pill pillBlock" : "pill pillWarn"}>
                      {rule.effect}
                    </span>
                  </td>
                  <td>
                    <span className="meta">
                      {[rule.connectors?.join(", "), rule.actions?.join(", ")].filter(Boolean).join(" / ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export async function PoliciesPageContent({
  workspaceSlug,
  searchParams
}: {
  workspaceSlug?: string;
  searchParams?: Promise<PoliciesSearchParams>;
} = {}) {
  const {
    workspaceContext,
    appViewMode,
    isAdmin,
    branches,
    rules,
    degraded,
  } = await getPoliciesPageModel({ workspaceSlug });
  if (searchParams) await searchParams;

  const environmentMappings = mapEnvironmentBranches(branches);
  const organizationBranches = branches.filter((branch) => branch.scope === "ORGANIZATION");
  const previewRules = rules.slice(0, RULE_PREVIEW_LIMIT);
  const awaitingReviewCount = branches.filter((branch) => branch.status === "IN_REVIEW").length;
  const rulesHref = buildWorkspacePath(workspaceContext.workspaceSlug, "/rules");
  const missingEnvironmentPolicies = environmentMappings.filter(({ branch }) => !branch).length;

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspaceContext)}</p>
          <h1>Policies</h1>
        </div>
        <div className="toolbar">
          <ImportPolicyPanel
            label="Create policy branch"
            workspaceId={workspaceContext.workspaceId}
            workspaceSlug={workspaceContext.workspaceSlug}
          />
        </div>
      </section>
      {degraded ? <DegradedDataNotice /> : null}

      <NeedsAttention awaitingReviewCount={awaitingReviewCount} missingEnvironmentPolicies={missingEnvironmentPolicies} hasBranches={branches.length > 0} workspaceId={workspaceContext.workspaceId} workspaceSlug={workspaceContext.workspaceSlug} />

      <EffectivePolicySection environmentMappings={environmentMappings} appViewMode={appViewMode} workspaceId={workspaceContext.workspaceId} workspaceSlug={workspaceContext.workspaceSlug} />

      <section className="panel policiesPanel" id="branches">
        <div className="rowHeader">
          <div>
            <p className="eyebrow">Provenance · Branches</p>
            <h2>
              Branches
              <span className="headCount">{branches.length}</span>
            </h2>
          </div>
        </div>
        <BranchTable
          branches={branches}
          isAdmin={isAdmin}
          viewMode={appViewMode}
          workspaceSlug={workspaceContext.workspaceSlug}
        />
      </section>

      <OrgBaselineSummary organizationBranches={organizationBranches} />

      <RulePreviewSection rules={rules} previewRules={previewRules} rulesHref={rulesHref} />
    </>
  );
}
