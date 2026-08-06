import { Download, ScrollText } from "lucide-react";
import {
  listBundleExportHistory,
  listOperationsLedgerKeyset,
  verifyOperationsLedger,
  type BundleExportLogEntries,
  type OperationsLogEntries,
} from "@/lib/domains/operations/service";
import { getWorkspaceContext } from "@/lib/workspace";
import { formatWorkspaceEyebrow } from "@/lib/workspace";
import { buildWorkspacePath } from "@/lib/workspace/path";
import type { OperationsLogChainVerification, OperationsLogEventType } from "@spctre/policy-schema";
import { formatArtifactHash, formatProvenanceId } from "@/lib/app-view-mode";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { getWebOnboardingStatus } from "@/lib/repositories/onboarding/shared";
import { QuickStartBanner } from "../quick-start-banner";
import { hashToFingerprint } from "@/lib/fingerprint";
import { getActiveActor, buildActorEmailFormatter } from "@/lib/actors";
import { VerifyChainButton } from "./verify-chain-button";
import { getTranslations } from "next-intl/server";

type OperationsTranslations = Awaited<ReturnType<typeof getTranslations>>;

function eventTypePillClass(eventType: string): string {
  if (eventType.startsWith("EVIDENCE")) return "pill pillAllow";
  if (eventType.startsWith("SIMULATION")) return "pill pillWarn";
  if (eventType.startsWith("POLICY")) return "pill pillWarn";
  if (eventType.startsWith("BUNDLE")) return "pill pillWarn";
  if (eventType.startsWith("ESCALATION")) return "pill pillBlock";
  if (eventType.startsWith("AGENT_")) return "pill pillWarn";
  if (eventType.startsWith("NOTIFICATION")) return "pill pillNeutral";
  if (eventType.startsWith("VERIFICATION")) return "pill pillAllow";
  if (eventType.startsWith("TRUST_SCORE")) return "pill pillNeutral";
  if (eventType.startsWith("IDENTITY")) return "pill pillNeutral";
  if (eventType.startsWith("TOKEN")) return "pill pillNeutral";
  if (eventType.startsWith("COMPLIANCE")) return "pill pillWarn";
  return "pill pillNeutral";
}

function eventTypeTooltip(eventType: string): string {
  const tooltips: Record<string, string> = {
    EVIDENCE_INGEST: "New evidence ingested into the system",
    EVIDENCE_EXPORT: "Evidence exported for compliance purposes",
    BUNDLE_EXPORT: "Policy bundle export preview, download, or blocked export recorded",
    EVIDENCE_PRUNE: "Expired evidence removed from retention",
    SIMULATION_RUN: "Simulation replay completed and recorded",
    POLICY_IMPORT: "Policy configuration imported",
    POLICY_PUBLISH: "Policy released to agents",
    POLICY_APPROVE: "Policy changes approved by reviewer",
    ESCALATION_OPENED: "High-risk decision escalated for review",
    ESCALATION_CLAIMED: "Escalated decision claimed for review",
    ESCALATION_RESOLVED: "Escalated decision resolved",
    AGENT_TRIAGE: "Historical advisor triage record",
    AGENT_RECOMMENDATION: "Historical advisor recommendation record",
    SIMULATION_GUIDANCE: "Inline simulation guidance or recorded reviewer response",
    NOTIFICATION_SENT: "Outbound notification delivered",
    NOTIFICATION_FAILED: "Outbound notification delivery failed",
    VERIFICATION_RUN: "Policy verification run completed",
    TRUST_SCORE_CHANGE: "Agent trust score updated",
    IDENTITY_CHANGE: "Identity configuration modified",
    TOKEN_ISSUED: "Authentication token issued",
    TOKEN_REVOKED: "Authentication token revoked",
    COMPLIANCE_EXPORT: "Compliance report generated",
  };
  return tooltips[eventType] || "Operation logged";
}

const EVENT_TYPE_GROUPS: Array<{
  group: string;
  options: Array<{ label: string; value: OperationsLogEventType }>;
}> = [
  {
    group: "Evidence",
    options: [
      { label: "Evidence Ingest", value: "EVIDENCE_INGEST" },
      { label: "Evidence Export", value: "EVIDENCE_EXPORT" },
      { label: "Evidence Prune", value: "EVIDENCE_PRUNE" },
      { label: "Simulation Run", value: "SIMULATION_RUN" },
    ],
  },
  {
    group: "Policy",
    options: [
      { label: "Policy Import", value: "POLICY_IMPORT" },
      { label: "Policy Publish", value: "POLICY_PUBLISH" },
      { label: "Policy Approve", value: "POLICY_APPROVE" },
      { label: "Bundle Export", value: "BUNDLE_EXPORT" },
      { label: "Verification Run", value: "VERIFICATION_RUN" },
    ],
  },
  {
    group: "Escalation",
    options: [
      { label: "Escalation Opened", value: "ESCALATION_OPENED" },
      { label: "Escalation Claimed", value: "ESCALATION_CLAIMED" },
      { label: "Escalation Resolved", value: "ESCALATION_RESOLVED" },
      { label: "Simulation Guidance", value: "SIMULATION_GUIDANCE" },
    ],
  },
  {
    group: "Identity & Tokens",
    options: [
      { label: "Identity Change", value: "IDENTITY_CHANGE" },
      { label: "Token Issued", value: "TOKEN_ISSUED" },
      { label: "Token Revoked", value: "TOKEN_REVOKED" },
      { label: "Trust Score", value: "TRUST_SCORE_CHANGE" },
    ],
  },
  {
    group: "System",
    options: [
      { label: "Notification Sent", value: "NOTIFICATION_SENT" },
      { label: "Notification Failed", value: "NOTIFICATION_FAILED" },
      { label: "Compliance Export", value: "COMPLIANCE_EXPORT" },
    ],
  },
];

const EVENT_TYPE_OPTIONS = EVENT_TYPE_GROUPS.flatMap((g) => g.options);

function bundleOutcomePillClass(outcome: string): string {
  if (outcome === "EXPORTED") return "pill pillAllow";
  if (outcome === "PREVIEW") return "pill pillNeutral";
  return "pill pillBlock";
}

function verifiedLabel(verified: boolean | null): string {
  if (verified === true) return "Verified";
  if (verified === false) return "Failed";
  return "Not run";
}

function verifiedPillClass(verified: boolean | null): string {
  if (verified === true) return "pill pillAllow";
  if (verified === false) return "pill pillBlock";
  return "pill pillNeutral";
}

function chainHealthPillClass(verification: OperationsLogChainVerification | null): string {
  if (!verification) return "pill pillNeutral";
  return verification.verified ? "pill pillAllow" : "pill pillBlock";
}

function chainHealthLabel(verification: OperationsLogChainVerification | null): string {
  if (!verification) return "Unavailable";
  if (!verification.verified) return "Broken";
  return verification.totalEntries === 0 ? "No entries" : "Verified";
}

function chainHealthDetail(
  verification: OperationsLogChainVerification | null,
  appViewMode: Awaited<ReturnType<typeof getAppViewMode>>,
): string {
  if (!verification) return "Verification could not run";
  if (verification.verified) return `${verification.totalEntries} entries checked`;
  if (verification.brokenEntryId) {
    return `Broken at ${formatProvenanceId(verification.brokenEntryId, appViewMode, 16, hashToFingerprint)}`;
  }
  if (verification.brokenAt)
    return `Broken at ${verification.brokenAt.slice(0, 16).replace("T", " ")}`;
  return "Chain verification failed";
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function OperationsEventRow({
  entry,
  appViewMode,
  formatActorId,
}: {
  entry: OperationsLogEntries[number];
  appViewMode: Awaited<ReturnType<typeof getAppViewMode>>;
  formatActorId: (id: string) => string;
}) {
  return (
    <tr className="auditRow operationsRow">
      <td>
        <time className="meta" dateTime={entry.createdAt}>
          {new Date(entry.createdAt).toLocaleString()}
        </time>
      </td>
      <td>
        <span
          className={eventTypePillClass(entry.eventType)}
          data-status-info={eventTypeTooltip(entry.eventType)}
          title={eventTypeTooltip(entry.eventType)}
        >
          {entry.eventType}
        </span>
      </td>
      <td>
        {entry.sourceId ? (
          <code className="smallCode">
            {entry.sourceTable ?? ""}
            {entry.sourceTable && entry.sourceId ? " / " : ""}
            {formatProvenanceId(entry.sourceId, appViewMode, 16, hashToFingerprint)}
          </code>
        ) : (
          <span className="meta">None</span>
        )}
      </td>
      <td>
        {entry.actorId ? (
          <code className="smallCode">
            {formatProvenanceId(entry.actorId, appViewMode, 16, formatActorId)}
          </code>
        ) : (
          <span className="meta">System</span>
        )}
      </td>
      <td>
        <code className="tinyCode mutedCode">
          {entry.contentHash
            ? formatArtifactHash(entry.contentHash, appViewMode, hashToFingerprint)
            : "None"}
        </code>
      </td>
    </tr>
  );
}

function BundleExportHistorySection({
  entries,
  appViewMode,
  formatActorId,
  t,
}: {
  entries: BundleExportLogEntries;
  appViewMode: Awaited<ReturnType<typeof getAppViewMode>>;
  formatActorId: (id: string) => string;
  t: OperationsTranslations;
}) {
  return (
    <section className="panel operationsPanel" id="bundle-exports">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("bundle_exports.eyebrow")}</p>
          <h2>{t("bundle_exports.title")}</h2>
          <p className="meta">
            {t.rich("bundle_exports.description", { table: (chunks) => <code>{chunks}</code> })}
          </p>
        </div>
        <Download size={20} className="sectionIcon" />
      </div>

      {entries.length === 0 ? (
        <div className="emptyState">
          <Download size={32} />
          <div>
            <h3>{t("bundle_exports.empty.title")}</h3>
            <p className="meta">{t("bundle_exports.empty.description")}</p>
          </div>
        </div>
      ) : (
        <div className="auditTableWrapper operationsTableWrapper">
          <table className="auditTable">
            <thead>
              <tr>
                <th>{t("table.time")}</th>
                <th>{t("bundle_exports.table.format")}</th>
                <th>{t("bundle_exports.table.outcome")}</th>
                <th>{t("bundle_exports.table.revision")}</th>
                <th>{t("bundle_exports.table.artifact")}</th>
                <th>{t("bundle_exports.table.compiled")}</th>
                <th>{t("bundle_exports.table.verified")}</th>
                <th>{t("table.actor")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr className="auditRow operationsRow" key={entry.id}>
                  <td>
                    <time className="meta" dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  </td>
                  <td>
                    <code className="smallCode">{entry.format}</code>
                  </td>
                  <td>
                    <span className={bundleOutcomePillClass(entry.outcome)}>{entry.outcome}</span>
                    {entry.blockingCount > 0 ? (
                      <span className="pill pillWarn" style={{ marginLeft: 6 }}>
                        {t("bundle_exports.blocked", { count: entry.blockingCount })}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <code className="smallCode">
                      {formatProvenanceId(entry.revisionId, appViewMode, 16, hashToFingerprint)}
                    </code>
                  </td>
                  <td>
                    <code className="tinyCode mutedCode">
                      {formatArtifactHash(entry.artifactHash, appViewMode, hashToFingerprint)}
                    </code>
                  </td>
                  <td>
                    <code className="tinyCode mutedCode">
                      {entry.compiledArtifactHash
                        ? formatArtifactHash(
                            entry.compiledArtifactHash,
                            appViewMode,
                            hashToFingerprint,
                          )
                        : "None"}
                    </code>
                  </td>
                  <td>
                    <span className={verifiedPillClass(entry.verified)}>
                      {verifiedLabel(entry.verified)}
                    </span>
                  </td>
                  <td>
                    {entry.actorId ? (
                      <code className="smallCode">
                        {formatProvenanceId(entry.actorId, appViewMode, 16, formatActorId)}
                      </code>
                    ) : (
                      <span className="meta">System</span>
                    )}
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

function OperationsHero({
  eventType,
  cursorUrl,
  inspectFailedEntryHref,
  loadedCount,
  eventTypeCount,
  actorCount,
  chainVerification,
  appViewMode,
  t,
}: {
  eventType: string | undefined;
  cursorUrl: (cursor: string | null, et?: string, entryId?: string | null) => string;
  inspectFailedEntryHref: string | null;
  loadedCount: number;
  eventTypeCount: number;
  actorCount: number;
  chainVerification: OperationsLogChainVerification | null;
  appViewMode: Awaited<ReturnType<typeof getAppViewMode>>;
  t: OperationsTranslations;
}) {
  return (
    <section className="operationsHero" aria-label={t("hero.aria_label")}>
      <div className="operationsHeroMain">
        <p className="eyebrow">{t("hero.eyebrow")}</p>
        <h2>{t("hero.title")}</h2>
        <p className="meta">{t("hero.description")}</p>
        {eventType ? (
          <div className="operationsHeroFilter">
            <span className={eventTypePillClass(eventType)}>{eventType}</span>
            <a className="button buttonSmall" href={cursorUrl(null)}>
              {t("filters.clear")}
            </a>
          </div>
        ) : null}
      </div>
      <div className="operationsHeroStats">
        <div>
          <span className="meta">{t("hero.stats.loaded")}</span>
          <strong>{loadedCount}</strong>
        </div>
        <div>
          <span className="meta">{t("hero.stats.event_types")}</span>
          <strong>{eventTypeCount}</strong>
        </div>
        <div>
          <span className="meta">{t("hero.stats.actors")}</span>
          <strong>{actorCount}</strong>
        </div>
        <div>
          <span className="meta">{t("hero.stats.chain_health")}</span>
          <strong>
            <span className={chainHealthPillClass(chainVerification)}>
              {chainHealthLabel(chainVerification)}
            </span>
          </strong>
          <span className="meta">{chainHealthDetail(chainVerification, appViewMode)}</span>
          <span className="meta">Tenant-wide check, including entries outside this workspace.</span>
          {inspectFailedEntryHref ? (
            <a className="button buttonSmall" href={inspectFailedEntryHref}>
              Inspect failed entry
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function OperationsFilters({
  eventType,
  cursorUrl,
  t,
}: {
  eventType: string | undefined;
  cursorUrl: (cursor: string | null, et?: string, entryId?: string | null) => string;
  t: OperationsTranslations;
}) {
  return (
    <div
      className="operationsFilters"
      style={{ flexDirection: "column", alignItems: "flex-start", gap: 12 }}
    >
      {EVENT_TYPE_GROUPS.map((group) => (
        <div
          key={group.group}
          style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
        >
          <span className="meta" style={{ fontSize: 11, minWidth: 110, textAlign: "right" }}>
            {group.group}
          </span>
          {group.options.map((opt) => (
            <a
              key={opt.value}
              href={cursorUrl(null, opt.value)}
              className={eventType === opt.value ? "pill pillAllow" : "pill pillNeutral"}
            >
              {opt.label}
            </a>
          ))}
        </div>
      ))}
      {eventType ? (
        <a
          className="button buttonSmall"
          href={cursorUrl(null)}
          style={{ alignSelf: "flex-start" }}
        >
          {t("filters.clear")}
        </a>
      ) : null}
    </div>
  );
}

function OperationsEventsSection({
  eventType,
  entryId,
  cursorUrl,
  entries,
  appViewMode,
  formatActorId,
  prevCursor,
  nextCursor,
  hasPrev,
  hasNext,
  t,
}: {
  eventType: string | undefined;
  entryId: string | undefined;
  cursorUrl: (cursor: string | null, et?: string, entryId?: string | null) => string;
  entries: OperationsLogEntries;
  appViewMode: Awaited<ReturnType<typeof getAppViewMode>>;
  formatActorId: (id: string) => string;
  prevCursor: string | null;
  nextCursor: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  t: OperationsTranslations;
}) {
  return (
    <section className="panel operationsPanel">
      <div className="rowHeader">
        <div>
          <p className="eyebrow">{t("events.eyebrow")}</p>
          <h2>{t("events.title")}</h2>
          <p className="meta">{t("events.description")}</p>
          {entryId ? (
            <p className="meta">
              Viewing ledger entry <code>{entryId}</code>.{" "}
              <a href={cursorUrl(null, eventType, null)}>Clear entry filter</a>
            </p>
          ) : null}
        </div>
      </div>

      <OperationsFilters eventType={eventType} cursorUrl={cursorUrl} t={t} />

      {entries.length === 0 ? (
        <div className="emptyState">
          <ScrollText size={32} />
          <div>
            <h3>{entryId ? "Entry is not visible in this workspace" : t("events.empty.title")}</h3>
            <p>
              {entryId
                ? "Chain health checks the tenant ledger. This failed entry belongs to another workspace or is not available in your current workspace scope."
                : t("events.empty.description")}
            </p>
            {!entryId ? <p className="meta operationsEmptyHint">{t("events.empty.hint")}</p> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="auditTableWrapper operationsTableWrapper">
            <table className="auditTable">
              <thead>
                <tr>
                  <th>{t("table.time")}</th>
                  <th>{t("table.event")}</th>
                  <th>{t("table.source")}</th>
                  <th>{t("table.actor")}</th>
                  <th>{t("table.hash")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <OperationsEventRow
                    key={entry.id}
                    entry={entry}
                    appViewMode={appViewMode}
                    formatActorId={formatActorId}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="operationsPagination">
            {hasPrev && (
              <a href={cursorUrl(prevCursor, eventType)} className="button buttonSmall">
                {t("pagination.previous")}
              </a>
            )}
            {hasNext && (
              <a href={cursorUrl(nextCursor, eventType)} className="button buttonSmall">
                {t("pagination.next")}
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export async function OperationsPageContent({
  workspaceSlug,
  searchParams,
}: { workspaceSlug?: string; searchParams?: Record<string, string> } = {}) {
  const t = await getTranslations("operations");
  const workspaceContext = await getWorkspaceContext({ workspaceSlug });
  const appViewMode = await getAppViewMode();
  const onboardingStatus = await getWebOnboardingStatus({
    tenantId: workspaceContext.tenantId,
    workspaceId: workspaceContext.workspaceId,
  });

  const eventType = (searchParams?.eventType as OperationsLogEventType | undefined) || undefined;
  const entryId = isUuid(searchParams?.entryId) ? searchParams?.entryId : undefined;
  const cursor = searchParams?.cursor || undefined;
  const limit = 50;

  let entries: OperationsLogEntries = [];
  let hasPrev = false;
  let hasNext = false;
  let prevCursor: string | null = null;
  let nextCursor: string | null = null;
  let bundleExports: BundleExportLogEntries = [];
  let chainVerification: OperationsLogChainVerification | null = null;
  let formatActorId: (id: string) => string = (id) => id;
  try {
    const [log, exportHistory, verification, activeActor] = await Promise.all([
      listOperationsLedgerKeyset({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
        eventType,
        entryId,
        limit,
        cursor,
      }),
      listBundleExportHistory({
        tenantId: workspaceContext.tenantId,
        workspaceId: workspaceContext.workspaceId,
        limit: 25,
        offset: 0,
      }),
      verifyOperationsLedger({ tenantId: workspaceContext.tenantId, limit: 500 }),
      getActiveActor({
        workspaceId: workspaceContext.workspaceId,
        tenantId: workspaceContext.tenantId,
      }),
    ]);
    entries = log.items;
    hasPrev = log.hasPrev;
    hasNext = log.hasNext;
    prevCursor = log.prevCursor;
    nextCursor = log.nextCursor;
    bundleExports = exportHistory;
    chainVerification = verification;
    formatActorId = buildActorEmailFormatter(activeActor.actors);
  } catch {
    // DB not available
  }

  const operationsPath = workspaceContext.workspaceSlug
    ? buildWorkspacePath(workspaceContext.workspaceSlug, "/operations")
    : "/operations";
  const eventTypeCount = new Set(entries.map((entry) => entry.eventType)).size;
  const actorCount = new Set(entries.map((entry) => entry.actorId).filter(Boolean)).size;

  // Keyset pagination URL: preserves the event-type filter and swaps the opaque
  // cursor (null = first page). See database-optimizations-audit finding 7.
  function cursorUrl(targetCursor: string | null, et?: string, targetEntryId = entryId ?? null) {
    const params = new URLSearchParams();
    if (targetCursor) params.set("cursor", targetCursor);
    if (et) params.set("eventType", et);
    if (targetEntryId) params.set("entryId", targetEntryId);
    const qs = params.toString();
    return `${operationsPath}${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">{formatWorkspaceEyebrow(workspaceContext)}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <VerifyChainButton />
        </div>
      </section>

      <OperationsHero
        eventType={eventType}
        cursorUrl={cursorUrl}
        loadedCount={entries.length}
        eventTypeCount={eventTypeCount}
        actorCount={actorCount}
        chainVerification={chainVerification}
        inspectFailedEntryHref={
          chainVerification?.verified || !chainVerification?.brokenEntryId
            ? null
            : cursorUrl(null, undefined, chainVerification.brokenEntryId)
        }
        appViewMode={appViewMode}
        t={t}
      />

      {onboardingStatus.realEvidenceCount === 0 ? (
        <QuickStartBanner
          controlPlaneUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://app.spctre.dev"}
          status={onboardingStatus}
          surface="operations"
          workspaceSlug={workspaceContext.workspaceSlug}
        />
      ) : null}

      <OperationsEventsSection
        eventType={eventType}
        entryId={entryId}
        cursorUrl={cursorUrl}
        entries={entries}
        appViewMode={appViewMode}
        formatActorId={formatActorId}
        prevCursor={prevCursor}
        nextCursor={nextCursor}
        hasPrev={hasPrev}
        hasNext={hasNext}
        t={t}
      />

      <BundleExportHistorySection
        entries={bundleExports}
        appViewMode={appViewMode}
        formatActorId={formatActorId}
        t={t}
      />
    </>
  );
}
