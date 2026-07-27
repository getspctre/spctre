"use client";

import { ChevronRight, GitBranch, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getPackCatalogTier, getPackMetadata, type PolicyPack } from "@spctre/policy-schema/packs";
import { SlideOutPanel } from "@/app/slide-out-panel";
import { ImportPackButton } from "./import-pack-button";
import { formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { buildWorkspacePath } from "@/lib/workspace/path";

const riskIcon = {
  HIGH: ShieldX,
  MEDIUM: ShieldAlert,
  LOW: ShieldCheck
};

const riskPill = {
  HIGH: "pill pillBlock",
  MEDIUM: "pill pillWarn",
  LOW: "pill pillAllow"
};

const effectPill: Record<string, string> = {
  DENY: "pill pillBlock",
  WARN: "pill pillWarn",
  ALLOW: "pill pillAllow",
  ESCALATE: "pill pillWarn",
  ABORT: "pill pillBlock",
};

const SIMPLE_ICON_OVERRIDES: Record<string, string> = {
  "adobe-sign": "adobe",
  "airbyte": "airbyte",
  "airtable": "airtable",
  "anthropic-api": "anthropic",
  "argo-cd": "argo",
  "asana": "asana",
  "atlassian": "atlassian",
  "auth0": "auth0",
  "aws-bedrock": "amazonwebservices",
  "aws-cloudtrail": "amazonwebservices",
  "aws-iam": "amazonwebservices",
  "aws-kms": "amazonwebservices",
  "aws-lambda": "awslambda",
  "aws-s3": "amazons3",
  "aws-secrets-manager": "amazonwebservices",
  "azure-devops": "azuredevops",
  "azure-functions": "azurefunctions",
  "azure-key-vault": "microsoftazure",
  "azure-kubernetes-service": "kubernetes",
  "azure-storage": "microsoftazure",
  "bigquery": "googlebigquery",
  "buildkite": "buildkite",
  "calendly": "calendly",
  "chargebee": "chargebee",
  "checkmarx": "checkmarx",
  "circleci": "circleci",
  "clickup": "clickup",
  "cloudflare-zero-trust": "cloudflare",
  "cloudflare": "cloudflare",
  "confluence": "confluence",
  "crowdstrike-falcon": "crowdstrike",
  "databricks": "databricks",
  "datadog": "datadog",
  "dependabot": "dependabot",
  "discord": "discord",
  "docker-hub": "docker",
  "docusign": "docusign",
  "dropbox": "dropbox",
  "duo": "duo",
  "elasticsearch": "elasticsearch",
  "expensify": "expensify",
  "figma": "figma",
  "fivetran": "fivetran",
  "freshdesk": "freshdesk",
  "fullstory": "fullstory",
  "gainsight": "gainsight",
  "github": "github",
  "gitlab": "gitlab",
  "google-cloud-iam": "googlecloud",
  "google-cloud-run": "googlecloud",
  "google-cloud-storage": "googlecloud",
  "google-meet": "googlemeet",
  "google-secret-manager": "googlecloud",
  "google-vertex-ai": "googlecloud",
  "google-workspace": "googleworkspace",
  "greenhouse": "greenhouse",
  "hashicorp-vault": "vault",
  "hubspot": "hubspot",
  "intercom": "intercom",
  "intune": "microsoftintune",
  "jira": "jira",
  "jenkins": "jenkins",
  "kafka": "apachekafka",
  "kubernetes": "kubernetes",
  "lacework": "lacework",
  "launchdarkly": "launchdarkly",
  "linear": "linear",
  "looker": "looker",
  "mailchimp": "mailchimp",
  "marketo": "adobe",
  "mattermost": "mattermost",
  "microsoft-365": "microsoft365",
  "microsoft-entra-id": "microsoft",
  "microsoft-teams": "microsoftteams",
  "mixpanel": "mixpanel",
  "mongodb": "mongodb",
  "netlify": "netlify",
  "new-relic": "newrelic",
  "notion": "notion",
  "npm": "npm",
  "okta": "okta",
  "onedrive": "microsoftonedrive",
  "onelogin": "onelogin",
  "onepassword": "1password",
  "onepassword-admin": "1password",
  "openai-api": "openai",
  "pagerduty": "pagerduty",
  "pendo": "pendo",
  "postgresql": "postgresql",
  "power-bi": "powerbi",
  "pypi": "pypi",
  "redis": "redis",
  "salesforce": "salesforce",
  "segment": "segment",
  "semgrep": "semgrep",
  "sentry": "sentry",
  "servicenow": "servicenow",
  "sharepoint": "microsoftsharepoint",
  "shopify": "shopify",
  "slack": "slack",
  "snowflake": "snowflake",
  "sonarqube": "sonarqube",
  "splunk": "splunk",
  "stripe": "stripe",
  "stripe-billing": "stripe",
  "tableau": "tableau",
  "tailscale": "tailscale",
  "terraform-cloud": "terraform",
  "trello": "trello",
  "twilio": "twilio",
  "uipath": "uipath",
  "vercel": "vercel",
  "veracode": "veracode",
  "woocommerce": "woocommerce",
  "workato": "workato",
  "zendesk": "zendesk",
  "zapier": "zapier",
  "zoom": "zoom"
};

function getConnectorLogoSlug(connector: string) {
  if (SIMPLE_ICON_OVERRIDES[connector]) return SIMPLE_ICON_OVERRIDES[connector];
  return connector.replace(/[^a-z0-9]/g, "");
}

const CONNECTOR_LOGO_DOMAINS: Partial<Record<string, string>> = {
  "twilio": "twilio.com"
};

// These connectors have no stable Simple Icons mark. Use the product's
// deterministic initials rather than issuing a request that will 404.
const CONNECTORS_WITHOUT_LOGO = new Set(["activecampaign", "deployment", "namely-hr"]);

function getConnectorLogoCandidates(connector: string) {
  if (CONNECTORS_WITHOUT_LOGO.has(connector)) return [];
  const logoSlug = getConnectorLogoSlug(connector);
  const candidates = [`https://cdn.simpleicons.org/${logoSlug}`];
  const domain = CONNECTOR_LOGO_DOMAINS[connector];

  if (domain) {
    candidates.push(`https://logo.clearbit.com/${domain}`);
  }

  return candidates;
}

function ConnectorLogo({
  connector,
  name,
  showRemoteLogo,
}: {
  connector: string;
  name: string;
  showRemoteLogo: boolean;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const logoCandidates = showRemoteLogo ? getConnectorLogoCandidates(connector) : [];
  const currentLogoSrc = logoCandidates[sourceIndex];
  const showFallback = sourceIndex >= logoCandidates.length;
  const fallback = connector
    .split(/[-_]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "PK";

  if (showFallback) {
    return (
      <span aria-hidden="true" className="packConnectorLogoFallback">
        {fallback}
      </span>
    );
  }

  return (
    <img
      alt={`${name} logo`}
      className="packConnectorLogo"
      key={currentLogoSrc}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.display = "none";
        setSourceIndex((current) => current + 1);
      }}
      src={currentLogoSrc}
    />
  );
}

interface PackSlideOutProps {
  pack: PolicyPack;
  installed?: {
    branchId: string;
    revisionId: string;
    installedVersion: string;
    installedAt: string;
    hasCustomizations: boolean;
  };
  isOutdated: boolean;
  upgradeSummary?: {
    addedFromUpstream: number;
    removedFromUpstream: number;
    modifiedFromUpstream: number;
    localOnlyRules: number;
  };
  workspaceId: string;
  workspaceSlug: string;
  viewMode: AppViewMode;
  immediatePublishAllowed: boolean;
  catalogStatusLoaded: boolean;
}

function PackGovernanceSection({ pack, metadata }: { pack: PolicyPack; metadata: ReturnType<typeof getPackMetadata> }) {
  const RiskIcon = riskIcon[pack.riskLevel];
  return (
    <div className="packRuleDetail">
      <p className="eyebrow">Governance</p>
      <div className="packRuleMeta">
        <div>
          <span className="meta">Owner</span>
          <strong>{metadata.owner}</strong>
        </div>
        <div>
          <span className="meta">Review requirements</span>
          <strong>{metadata.reviewRoles.join(", ")} ({metadata.minimumApprovals} approvals)</strong>
        </div>
        <div>
          <span className="meta">Compatibility targets</span>
          <strong>{metadata.compatibilityTargets.join(", ")}</strong>
        </div>
        <div>
          <span className="meta">Risk</span>
          <span className={riskPill[pack.riskLevel]}>
            <RiskIcon size={13} />
            {pack.riskLevel}
          </span>
        </div>
      </div>
    </div>
  );
}

function PackRulesSection({ pack }: { pack: PolicyPack }) {
  return (
    <section className="packDrawerRules" aria-labelledby={`${pack.id}-rules`}>
      <div>
        <p className="eyebrow">Rules</p>
        <h3 id={`${pack.id}-rules`}>Rules in this pack</h3>
      </div>

      {pack.rules.map((rule) => (
        <article className="packRuleDetail" key={rule.stableRuleId}>
          <div className="rowHeader">
            <div>
              <h3>{rule.title}</h3>
              <p className="meta">
                <code>{rule.stableRuleId}</code>
                {rule.immutable ? " / immutable" : ""}
              </p>
            </div>
            <span className={effectPill[rule.effect]}>{rule.effect}</span>
          </div>

          <div className="packRuleMeta">
            <div>
              <span className="meta">Domains</span>
              <strong>{rule.domains.join(", ") || "Any"}</strong>
            </div>
            <div>
              <span className="meta">Actions</span>
              <strong>{rule.actions.join(", ") || "Any"}</strong>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function PackChangelogSection({ pack, metadata }: { pack: PolicyPack; metadata: ReturnType<typeof getPackMetadata> }) {
  if (metadata.changelog.length === 0) return null;
  return (
    <section className="packDrawerRules" aria-labelledby={`${pack.id}-changelog`}>
      <div>
        <p className="eyebrow">Changelog</p>
        <h3 id={`${pack.id}-changelog`}>Recent versions</h3>
      </div>

      {metadata.changelog.slice(0, 3).map((entry) => (
        <article className="packRuleDetail" key={`${pack.id}-${entry.version}-${entry.date}`}>
          <div className="rowHeader">
            <div>
              <h3>v{entry.version}</h3>
              <p className="meta">{entry.date}</p>
            </div>
          </div>
          <p>{entry.summary}</p>
        </article>
      ))}
    </section>
  );
}

function UpgradePreviewSection({
  pack,
  upgradeSummary,
}: {
  pack: PolicyPack;
  upgradeSummary: NonNullable<PackSlideOutProps["upgradeSummary"]>;
}) {
  return (
    <section className="packDrawerRules" aria-labelledby={`${pack.id}-upgrade-preview`}>
      <div>
        <p className="eyebrow">Upgrade preview</p>
        <h3 id={`${pack.id}-upgrade-preview`}>Diff vs. installed</h3>
      </div>
      <div className="packUpgradeSummary">
        <div>
          <span className="meta">Upstream added</span>
          <strong>{upgradeSummary.addedFromUpstream}</strong>
        </div>
        <div>
          <span className="meta">Upstream modified</span>
          <strong>{upgradeSummary.modifiedFromUpstream}</strong>
        </div>
        <div>
          <span className="meta">Not in upstream</span>
          <strong>{upgradeSummary.localOnlyRules}</strong>
        </div>
      </div>
    </section>
  );
}

function PackCardContent({
  pack,
  metadata,
  installed,
  isInstalled,
  isOutdated,
}: {
  pack: PolicyPack;
  metadata: ReturnType<typeof getPackMetadata>;
  installed: PackSlideOutProps["installed"];
  isInstalled: boolean;
  isOutdated: boolean;
}) {
  const t = useTranslations("packs");
  const RiskIcon = riskIcon[pack.riskLevel];
  const catalogTier = getPackCatalogTier(pack);
  return (
    <>
      <span className="packCardHeader">
        <span className="packCardTitle">
          <ConnectorLogo
            connector={pack.connector}
            name={pack.name}
            showRemoteLogo={catalogTier === "canonical"}
          />
          <span>
            <span className="packCardName">{pack.name}</span>
            <span className="meta">connector: {pack.connector}</span>
          </span>
        </span>
        <span className={riskPill[pack.riskLevel]}>
          <RiskIcon size={13} />
          {pack.riskLevel}
        </span>
        <span className={catalogTier === "canonical" ? "pill pillAllow" : "pill"}>
          {t(`tiers.${catalogTier}.pill`)}
        </span>
      </span>

      <span className="packDescription">{pack.description}</span>

      <span className="packMeta">
        <span>
          <span className="meta">Rules</span>
          <strong>{pack.rules.length}</strong>
        </span>
        <span>
          <span className="meta">Domains</span>
          <strong>{pack.domains.length}</strong>
        </span>
        <span>
          <span className="meta">Scope</span>
          <strong>CONNECTOR</strong>
        </span>
      </span>

      <span className="packTags" aria-label="Pack tags">
        {pack.tags.slice(0, 5).map((tag) => (
          <span className="ruleRef" key={tag}>
            {tag}
          </span>
        ))}
      </span>

      <span className="packCardCta">
        <span>
          {isInstalled
            ? isOutdated
              ? `Upgrade available (${installed?.installedVersion} -> ${metadata.version})`
              : `Installed · v${installed?.installedVersion}`
            : "Review rules and install"}
        </span>
        <ChevronRight size={16} />
      </span>
    </>
  );
}

export function PackSlideOut({
  pack,
  installed,
  isOutdated,
  upgradeSummary,
  workspaceId,
  workspaceSlug,
  viewMode,
  immediatePublishAllowed,
  catalogStatusLoaded,
}: PackSlideOutProps) {
  const t = useTranslations("packs");
  const metadata = getPackMetadata(pack);
  const catalogTier = getPackCatalogTier(pack);
  const isInstalled = Boolean(installed);
  const router = useRouter();
  const [pendingReviewBranchId, setPendingReviewBranchId] = useState<string | null>(null);

  function handlePackComplete(branchId: string) {
    setPendingReviewBranchId(branchId);
    router.refresh();
  }

  return (
    <SlideOutPanel
      description={pack.description}
      eyebrow={`connector: ${pack.connector} / v${metadata.version}`}
      title={pack.name}
      width="wide"
      trigger={({ open, triggerId }) => (
        <article className="packCard">
          <button
            aria-label={`Open ${pack.name} details`}
            className="packCardButton"
            id={triggerId}
            onClick={open}
            type="button"
          >
            <PackCardContent
              pack={pack}
              metadata={metadata}
              installed={installed}
              isInstalled={isInstalled}
              isOutdated={isOutdated}
            />
          </button>
        </article>
      )}
    >
      <div className="packDrawerSummary">
        <div>
          <span className="meta">{t("tiers.catalog_status")}</span>
          <strong>{t(`tiers.${catalogTier}.status`)}</strong>
        </div>
        <div>
          <span className="meta">Rules</span>
          <strong>{pack.rules.length}</strong>
        </div>
        <div>
          <span className="meta">Domains</span>
          <strong>{pack.domains.join(", ")}</strong>
        </div>
        <div>
          <span className="meta">Version</span>
          <strong>{metadata.version}</strong>
        </div>
      </div>

      <PackGovernanceSection pack={pack} metadata={metadata} />

      <div className="packDrawerTags">
        {pack.tags.map((tag) => (
          <span className="ruleRef" key={tag}>
            {tag}
          </span>
        ))}
      </div>

      {isInstalled ? (
        <div className="packRuleDetail">
          <p className="eyebrow">Installed</p>
          <div className="packRuleMeta">
            <div>
              <span className="meta">Branch</span>
              <code className="breakCode">
                {formatProvenanceId(installed?.branchId, viewMode, 16, hashToFingerprint)}
              </code>
            </div>
            <div>
              <span className="meta">Revision</span>
              <code className="breakCode">
                {formatProvenanceId(installed?.revisionId, viewMode, 16, hashToFingerprint)}
              </code>
            </div>
            <div>
              <span className="meta">Installed</span>
              <strong>{installed?.installedAt.slice(0, 10)}</strong>
            </div>
          </div>
        </div>
      ) : null}

      <PackRulesSection pack={pack} />

      <PackChangelogSection pack={pack} metadata={metadata} />

      {isInstalled && isOutdated && upgradeSummary ? (
        <UpgradePreviewSection pack={pack} upgradeSummary={upgradeSummary} />
      ) : null}

      <div className="packDrawerFooter">
        {!catalogStatusLoaded ? (
          <p className="meta">Pack status is unavailable. Reload to see available actions.</p>
        ) : pendingReviewBranchId ? (
          <div className="packInstallActions">
            <span className="pill pillWarn">
              <GitBranch size={12} />
              Pending review
            </span>
            <Link
              className="button buttonPrimary"
              href={buildWorkspacePath(workspaceSlug, `/review?branch=${pendingReviewBranchId}`)}
            >
              Open review
            </Link>
          </div>
        ) : isInstalled ? (
          <div className="packInstallActions">
            <span className="pill pillAllow">Installed · v{installed?.installedVersion}</span>
            {installed?.hasCustomizations ? (
              <span className="pill pillWarn">Custom rules present</span>
            ) : null}
            {isOutdated ? (
              <ImportPackButton
                packId={pack.id}
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                mode="upgrade"
                hasCustomizations={Boolean(installed?.hasCustomizations)}
                rulesCount={pack.rules.length}
                onComplete={handlePackComplete}
                immediatePublishAllowed={immediatePublishAllowed}
              />
            ) : null}
          </div>
        ) : (
          <ImportPackButton
            packId={pack.id}
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            mode="install"
            hasCustomizations={false}
            rulesCount={pack.rules.length}
            onComplete={handlePackComplete}
            immediatePublishAllowed={immediatePublishAllowed}
          />
        )}
      </div>
    </SlideOutPanel>
  );
}
