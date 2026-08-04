"use client";

import { Search } from "lucide-react";
import type {
  RuntimeDecisionStatus,
  RuntimeEvidenceSearchResult,
  RuntimeStack,
} from "@spctre/policy-schema";
import { runtimeLabels } from "@/lib/constants";
import { hashToFingerprint } from "@/lib/fingerprint";
import { SlideOutPanel } from "@/app/slide-out-panel";

interface Props {
  actionPath: string;
  defaultOpen?: boolean;
  forensicMode: boolean;
  searchResult: RuntimeEvidenceSearchResult;
  statuses: RuntimeDecisionStatus[];
  runtimeStacks: RuntimeStack[];
  crossSurfaceIdentity?: boolean;
}

function SearchResultCard({
  result,
  forensicMode,
  crossSurfaceIdentity,
}: {
  result: RuntimeEvidenceSearchResult["results"][number];
  forensicMode: boolean;
  crossSurfaceIdentity?: boolean;
}) {
  const packVersions = Array.from(
    new Set(
      result.policyContext
        .map((context) =>
          context.packVersion ? `${context.packId ?? "pack"}@${context.packVersion}` : undefined,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return (
    <article className="searchResult">
      <div className="rowHeader">
        <div>
          <h3>
            {result.connector}.{result.action}
          </h3>
          <p className="meta">
            <code>{forensicMode ? result.decisionId : `${result.decisionId.slice(0, 16)}...`}</code>{" "}
            /{" "}
            {crossSurfaceIdentity ? (
              <a
                href={`/api/agents/${encodeURIComponent(result.agentId)}/identity-history`}
                title="Cross-surface identity history"
              >
                {result.agentId}
              </a>
            ) : (
              result.agentId
            )}{" "}
            / {runtimeLabels[result.runtimeTarget.stack]} / {result.createdAt.slice(0, 10)}
          </p>
          {forensicMode ? (
            <p className="meta" style={{ marginTop: 2 }}>
              <code style={{ fontSize: 10 }}>{result.artifactHash}</code>
            </p>
          ) : (
            <p className="meta" style={{ marginTop: 2, fontStyle: "italic" }}>
              {hashToFingerprint(result.artifactHash)}
            </p>
          )}
        </div>
        <span
          className={
            result.status === "DENY"
              ? "pill pillBlock"
              : result.status === "WARN"
                ? "pill pillWarn"
                : "pill pillAllow"
          }
        >
          {result.status}
        </span>
      </div>
      {packVersions.length > 0 ? (
        <div className="policyRefs">
          {packVersions.map((packVersion) => (
            <span className="ruleRef" key={`${result.decisionId}-${packVersion}`}>
              {packVersion}
            </span>
          ))}
        </div>
      ) : null}
      <p className="meta">{result.reason}</p>
      <div className="policyRefs">
        {result.policyRefs.map((policyRef) => (
          <span className="ruleRef" key={`${result.decisionId}-${policyRef}`}>
            {policyRef}
          </span>
        ))}
      </div>
    </article>
  );
}

function deriveSearchFormDefaults(searchResult: RuntimeEvidenceSearchResult) {
  return {
    selectedStatus: searchResult.query.statuses?.[0] ?? "",
    selectedStack: searchResult.query.runtimeStacks?.[0] ?? "",
    selectedConnector: searchResult.query.connectors?.[0] ?? "",
    selectedBranch: searchResult.query.branchId ?? "",
    selectedRevision: searchResult.query.revisionId ?? "",
    fromDate: searchResult.query.from?.slice(0, 10) ?? "",
    toDate: searchResult.query.to?.slice(0, 10) ?? "",
  };
}

function ActiveFilterChips({ searchResult }: { searchResult: RuntimeEvidenceSearchResult }) {
  return (
    <div className="searchFilters" aria-label="Evidence search filters">
      {searchResult.query.statuses?.map((status) => (
        <span className="ruleRef" key={`status-${status}`}>
          status:{status}
        </span>
      ))}
      {searchResult.query.runtimeStacks?.map((stack) => (
        <span className="ruleRef" key={`stack-${stack}`}>
          stack:{runtimeLabels[stack]}
        </span>
      ))}
      {searchResult.query.connectors?.map((connector) => (
        <span className="ruleRef" key={`connector-${connector}`}>
          connector:{connector}
        </span>
      ))}
      {searchResult.query.from ? (
        <span className="ruleRef">from:{searchResult.query.from.slice(0, 10)}</span>
      ) : null}
      {searchResult.query.to ? (
        <span className="ruleRef">to:{searchResult.query.to.slice(0, 10)}</span>
      ) : null}
    </div>
  );
}

export function EvidenceSearchInspector({
  actionPath,
  defaultOpen = false,
  forensicMode,
  searchResult,
  statuses,
  runtimeStacks,
  crossSurfaceIdentity,
}: Props) {
  const {
    selectedStatus,
    selectedStack,
    selectedConnector,
    selectedBranch,
    selectedRevision,
    fromDate,
    toDate,
  } = deriveSearchFormDefaults(searchResult);
  const queryLabel = searchResult.query.text || "all evidence";
  const resetHref = `${actionPath}?inspector=search`;

  return (
    <SlideOutPanel
      defaultOpen={defaultOpen}
      description={`${searchResult.returnedCount} of ${searchResult.totalCount} matching runtime decisions`}
      eyebrow="Evidence · Search"
      title={`Query ${queryLabel}`}
      width="wide"
      trigger={({ open, triggerId }) => (
        <button className="button" id={triggerId} onClick={open} type="button">
          <Search size={16} />
          Search
        </button>
      )}
    >
      <form className="searchForm" action={actionPath}>
        <input name="inspector" type="hidden" value="search" />
        <label>
          <span>Text</span>
          <input
            name="q"
            defaultValue={searchResult.query.text ?? ""}
            placeholder="refund, agent, hash..."
          />
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={selectedStatus}>
            <option value="">Any</option>
            {statuses.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Connector</span>
          <input name="connector" defaultValue={selectedConnector} placeholder="stripe" />
        </label>
        <label>
          <span>Stack</span>
          <select name="stack" defaultValue={selectedStack}>
            <option value="">Any</option>
            {runtimeStacks.map((stack) => (
              <option value={stack} key={stack}>
                {runtimeLabels[stack]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Branch</span>
          <input name="branch" defaultValue={selectedBranch} placeholder="br-prod-support" />
        </label>
        <label>
          <span>Revision</span>
          <input name="revision" defaultValue={selectedRevision} placeholder="rev-8f12" />
        </label>
        <label>
          <span>From</span>
          <input name="from" type="date" defaultValue={fromDate} />
        </label>
        <label>
          <span>To</span>
          <input name="to" type="date" defaultValue={toDate} />
        </label>
        <div className="searchActions">
          <button className="button buttonPrimary" type="submit">
            <Search size={16} />
            Search
          </button>
          <a className="button" href={resetHref}>
            Reset
          </a>
        </div>
      </form>

      <ActiveFilterChips searchResult={searchResult} />

      <div className="searchSummary" aria-label="Evidence search summary">
        <div>
          <span className="meta">Denied</span>
          <strong>{searchResult.deniedCount}</strong>
        </div>
        <div>
          <span className="meta">Warned</span>
          <strong>{searchResult.warnedCount}</strong>
        </div>
        <div>
          <span className="meta">Allowed</span>
          <strong>{searchResult.allowedCount}</strong>
        </div>
        <div>
          <span className="meta">Policy refs</span>
          <strong>{searchResult.policyRefCount}</strong>
        </div>
      </div>

      <div className="searchResults">
        {searchResult.results.map((result) => (
          <SearchResultCard
            key={result.decisionId}
            result={result}
            forensicMode={forensicMode}
            crossSurfaceIdentity={crossSurfaceIdentity}
          />
        ))}
        {searchResult.results.length === 0 ? (
          <div className="emptyState">
            <h3>No evidence matched</h3>
            <p className="meta">Adjust the filters to widen the runtime decision trail.</p>
          </div>
        ) : null}
      </div>
    </SlideOutPanel>
  );
}
