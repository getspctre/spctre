"use client";

import { useId, useRef, useState } from "react";
import { EvidencePanelBody, type ControlMappingEntry } from "./evidence-table";
import { EvidenceTimestamp } from "./evidence-timestamp";
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
  workspaceSlug?: string;
  controlMappingIndex?: ControlMappingEntry[];
  evidence: RuntimeEvidenceSearchResult["results"];
}

function SearchResultCard({
  result,
  forensicMode,
  crossSurfaceIdentity,
  onInspect,
}: {
  onInspect: () => void;
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
      <button type="button" className="button buttonSmall" onClick={onInspect}>
        Inspect decision
      </button>
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
            / {runtimeLabels[result.runtimeTarget.stack]} /{" "}
            <EvidenceTimestamp value={result.createdAt} />
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
  workspaceSlug,
  controlMappingIndex,
  evidence,
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
  const [selected, setSelected] = useState<RuntimeEvidenceSearchResult["results"][number] | null>(
    null,
  );
  const [branchFilter, setBranchFilter] = useState(searchResult.query.branchId ?? "");
  const listId = useId();
  const backRef = useRef<HTMLButtonElement>(null);
  const inspectTrigger = useRef<HTMLElement | null>(null);
  const contextNodes = evidence.flatMap((record) => record.policyContext);
  const branches = Array.from(
    new Map(contextNodes.map((context) => [context.branchId, context])).values(),
  );
  const revisions = Array.from(
    new Map(
      contextNodes
        .filter((context) => !branchFilter || context.branchId === branchFilter)
        .map((context) => [context.revisionId, context]),
    ).values(),
  );
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
      {selected ? (
        <div>
          <button
            ref={backRef}
            type="button"
            className="button"
            onClick={() => {
              setSelected(null);
              requestAnimationFrame(() => inspectTrigger.current?.focus());
            }}
          >
            Back to search results
          </button>
          <h3>
            {selected.connector}.{selected.action}
          </h3>
          <EvidencePanelBody
            audit={selected}
            viewMode={forensicMode ? "forensic" : "executive"}
            workspaceSlug={workspaceSlug}
            controlMappingIndex={controlMappingIndex}
          />
        </div>
      ) : null}
      <div hidden={Boolean(selected)}>
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
            <input
              name="branch"
              list={`${listId}-branches`}
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              placeholder="Choose a branch or enter its ID"
            />
            <datalist id={`${listId}-branches`}>
              {branches.map((branch) => (
                <option key={branch.branchId} value={branch.branchId}>
                  {(branch as typeof branch & { branchName?: string }).branchName ?? branch.scope}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            <span>Revision</span>
            <input
              key={branchFilter}
              name="revision"
              list={`${listId}-revisions`}
              defaultValue={branchFilter === selectedBranch ? selectedRevision : ""}
              placeholder="Choose a revision or enter its ID"
            />
            <datalist id={`${listId}-revisions`}>
              {revisions.map((revision) => (
                <option key={revision.revisionId} value={revision.revisionId}>
                  {revision.packId ?? revision.scope}
                  {revision.packVersion ? ` ${revision.packVersion}` : ""}
                </option>
              ))}
            </datalist>
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
              onInspect={() => {
                inspectTrigger.current = document.activeElement as HTMLElement;
                setSelected(result);
                requestAnimationFrame(() => backRef.current?.focus());
              }}
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
      </div>
    </SlideOutPanel>
  );
}
