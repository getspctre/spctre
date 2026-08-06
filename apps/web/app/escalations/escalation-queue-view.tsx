"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { GatewayEscalationQueueItem } from "@spctre/policy-schema";
import { ClaimButton } from "./claim-button";
import { ResolveForm } from "./resolve-form";
import { formatProvenanceId, type AppViewMode } from "@/lib/app-view-mode";
import { hashToFingerprint } from "@/lib/fingerprint";
import { redactAndBoundParameters } from "@spctre/api-contracts";
import { UpgradePrompt } from "../plan-gate";
import { useTranslations } from "next-intl";

interface EscalationQueueViewProps {
  initialQueue: GatewayEscalationQueueItem[];
  initialLoadFailed?: boolean;
  actors: Array<{ id: string; name: string; email: string | null; reviewerRoles: string[] }>;
  hasManagedHitl: boolean;
  crossSurfaceIdentity: boolean;
  appViewMode: AppViewMode;
  workspaceEyebrow?: string;
  onboardingBanner?: React.ReactNode;
}

function slaPillClass(slaDueAt: string, currentTime: number) {
  const msUntilDue = new Date(slaDueAt).getTime() - currentTime;
  if (msUntilDue < 0) return "pill pillBlock";
  if (msUntilDue < 60 * 60 * 1000) return "pill pillWarn";
  return "pill pillAllow";
}

function slaLabel(slaDueAt: string, currentTime: number) {
  const msUntilDue = new Date(slaDueAt).getTime() - currentTime;
  if (msUntilDue < 0) return "OVERDUE";
  const hoursLeft = Math.ceil(msUntilDue / (60 * 60 * 1000));
  return `${hoursLeft}h left`;
}

function refreshedAgoLabel(currentTime: number, lastRefreshedAt: number) {
  const secondsAgo = Math.floor((currentTime - lastRefreshedAt) / 1000);
  if (secondsAgo < 10) return "Just now";
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  return `${Math.floor(secondsAgo / 60)}m ago`;
}

function riskLevelPillClass(riskLevel: string) {
  if (riskLevel === "HIGH" || riskLevel === "CRITICAL") return "pill pillBlock pillTiny";
  return riskLevel === "MEDIUM" ? "pill pillWarn pillTiny" : "pill pillAllow pillTiny";
}

function reviewParameterLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function reviewParameterValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "—";
  return JSON.stringify(value, null, 2);
}

function ReviewContext({
  parameters,
  title,
}: {
  parameters: Record<string, unknown>;
  title: string;
}) {
  // Defence in depth only. The queue projection is already redacted and
  // bounded server-side, in the repository, because anything left on the item
  // reaches the browser through the API response and the RSC props regardless
  // of what this component renders. Redacting again here is idempotent and
  // keeps the guarantee if the component is ever handed an unredacted source.
  const entries = Object.entries(redactAndBoundParameters(parameters) ?? {});
  if (entries.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="metadata" style={{ fontSize: 10 }}>
        {title}
      </span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px minmax(0, 1fr)",
          gap: "8px 16px",
          background: "var(--bg)",
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "12px 14px",
        }}
      >
        {entries.map(([key, value]) => (
          <React.Fragment key={key}>
            <span className="meta" style={{ fontSize: 12 }}>
              {reviewParameterLabel(key)}
            </span>
            <code
              style={{
                color: "var(--ink)",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.45,
              }}
            >
              {reviewParameterValue(value)}
            </code>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function QueueListItem({
  item,
  isSelected,
  onSelect,
  appViewMode,
  currentTime,
}: {
  item: GatewayEscalationQueueItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  appViewMode: AppViewMode;
  currentTime: number;
}) {
  const t = useTranslations("escalations.queue");

  return (
    <button
      onClick={() => onSelect(item.id)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "14px 18px",
        border: 0,
        borderBottom: "1px solid var(--line)",
        background: isSelected ? "var(--bg)" : "var(--panel)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "background 0.2s ease",
        position: "relative",
      }}
    >
      {isSelected && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: "var(--accent)",
          }}
        />
      )}
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
      >
        <code
          style={{
            fontSize: 11,
            background: isSelected ? "oklch(0.88 0.014 250)" : "oklch(0.94 0.012 250)",
          }}
        >
          {formatProvenanceId(item.decisionId, appViewMode, 12, hashToFingerprint)}
        </code>
        <span
          className={
            item.status === "IN_REVIEW" ? "pill pillWarn pillTiny" : "pill pillNeutral pillTiny"
          }
        >
          {item.status}
        </span>
      </div>
      <p
        className="meta"
        style={{
          fontWeight: 600,
          color: "var(--ink)",
          fontSize: 13,
          textOverflow: "ellipsis",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {[item.connector, item.action].filter(Boolean).join(".") || t("runtime_decision")}
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 2,
        }}
      >
        <span
          className={slaPillClass(item.slaDueAt, currentTime)}
          style={{ fontSize: 9, padding: "1px 5px", minHeight: "auto" }}
        >
          {slaLabel(item.slaDueAt, currentTime)}
        </span>
        <span className="meta" style={{ fontSize: 11 }}>
          {item.assignedTo ? t("assigned") : t("unassigned")}
        </span>
      </div>
    </button>
  );
}

function EscalationDetailHeader({
  selectedItem,
  currentTime,
  formatActorId,
}: {
  selectedItem: GatewayEscalationQueueItem;
  currentTime: number;
  formatActorId: (id: string) => string;
}) {
  const t = useTranslations("escalations.detail");

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 6 }}>
        {t("eyebrow")}
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: "monospace",
              fontSize: 15,
              wordBreak: "break-all",
              fontWeight: 700,
            }}
          >
            {t("id", { id: selectedItem.decisionId })}
          </h2>
          {selectedItem.revisionId && (
            <p className="meta" style={{ fontSize: 12, marginTop: 4 }}>
              {t("policy_revision")} <code style={{ fontSize: 11 }}>{selectedItem.revisionId}</code>
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span
            className={selectedItem.status === "IN_REVIEW" ? "pill pillWarn" : "pill pillNeutral"}
          >
            {selectedItem.status}
          </span>
          <span className={slaPillClass(selectedItem.slaDueAt, currentTime)}>
            {slaLabel(selectedItem.slaDueAt, currentTime)}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <p className="meta" style={{ fontSize: 12 }}>
          <strong>{t("created")}</strong> {new Date(selectedItem.createdAt).toLocaleString()}
        </p>
        <p className="meta" style={{ fontSize: 12 }}>
          <strong>{t("assignee")}</strong>{" "}
          {selectedItem.assignedTo ? (
            <code style={{ fontSize: 11 }}>{formatActorId(selectedItem.assignedTo)}</code>
          ) : (
            <span style={{ color: "var(--warn)", fontWeight: 600 }}>{t("unassigned")}</span>
          )}
        </p>
      </div>
    </div>
  );
}

function EscalationContextDetails({
  selectedItem,
  crossSurfaceIdentity,
}: {
  selectedItem: GatewayEscalationQueueItem;
  crossSurfaceIdentity: boolean;
}) {
  const t = useTranslations("escalations.context");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 className="metadata">{t("title")}</h3>

      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "8px 16px" }}>
        <span className="meta" style={{ fontSize: 12 }}>
          {t("connector")}
        </span>
        <span className="meta" style={{ color: "var(--ink)", fontWeight: 600, fontSize: 12 }}>
          {selectedItem.connector || "—"}
        </span>

        <span className="meta" style={{ fontSize: 12 }}>
          {t("action")}
        </span>
        <span className="meta" style={{ color: "var(--ink)", fontWeight: 600, fontSize: 12 }}>
          {selectedItem.action || "—"}
        </span>

        {selectedItem.agentId && (
          <>
            <span className="meta" style={{ fontSize: 12 }}>
              Agent
            </span>
            <span
              className="meta"
              style={{
                color: "var(--ink)",
                fontWeight: 600,
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <code style={{ fontSize: 11 }}>{selectedItem.agentId}</code>
              {crossSurfaceIdentity && (
                <a
                  className="meta"
                  href={`/api/agents/${encodeURIComponent(selectedItem.agentId)}/identity-history`}
                  style={{ fontSize: 11, textDecoration: "underline" }}
                >
                  Cross-surface identity history
                </a>
              )}
            </span>
          </>
        )}

        {selectedItem.riskLevel && (
          <>
            <span className="meta" style={{ fontSize: 12 }}>
              {t("risk_level")}
            </span>
            <span>
              <span className={riskLevelPillClass(selectedItem.riskLevel)}>
                {selectedItem.riskLevel}
              </span>
            </span>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        <span className="metadata" style={{ fontSize: 10 }}>
          {t("handoff_notes")}
        </span>
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "12px 14px",
            fontSize: 13,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--ink)",
            lineHeight: 1.45,
          }}
        >
          {selectedItem.handoffNotes ?? t("no_handoff_notes")}
        </div>
      </div>

      {selectedItem.toolIntent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="metadata" style={{ fontSize: 10 }}>
            {t("tool_intent")}
          </span>
          <code
            style={{
              padding: "10px 12px",
              display: "block",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 11,
            }}
          >
            {selectedItem.toolIntent}
          </code>
        </div>
      )}

      {selectedItem.planSummary && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="metadata" style={{ fontSize: 10 }}>
            {t("plan_summary")}
          </span>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "12px 14px",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "monospace",
              lineHeight: 1.45,
            }}
          >
            {selectedItem.planSummary}
          </div>
        </div>
      )}

      {selectedItem.toolParameters && (
        <ReviewContext parameters={selectedItem.toolParameters} title={t("review_context")} />
      )}

      {selectedItem.safeguardTelemetry &&
        Object.keys(selectedItem.safeguardTelemetry).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="metadata" style={{ fontSize: 10 }}>
              Gateway safeguard evaluation
            </span>
            <code
              style={{
                padding: "10px 12px",
                display: "block",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 11,
              }}
            >
              {JSON.stringify(selectedItem.safeguardTelemetry, null, 2)}
            </code>
          </div>
        )}
    </div>
  );
}

function EscalationAssignmentSection({
  selectedItem,
  hasManagedHitl,
  formatActorId,
  onClaimed,
}: {
  selectedItem: GatewayEscalationQueueItem;
  hasManagedHitl: boolean;
  formatActorId: (id: string) => string;
  onClaimed: () => void;
}) {
  const t = useTranslations("escalations.triage");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 className="metadata">Assignment</h3>
      {hasManagedHitl ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!selectedItem.assignedTo && (
            <div style={{ alignSelf: "flex-start" }}>
              <ClaimButton queueId={selectedItem.id} onClaimed={onClaimed} />
            </div>
          )}
          <p className="meta" style={{ fontSize: 12 }}>
            {selectedItem.assignedTo
              ? t.rich("claimed_by", {
                  email: formatActorId(selectedItem.assignedTo),
                  code: (chunks) => <code>{chunks}</code>,
                })
              : t("claim_prompt")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="meta" style={{ fontSize: 12 }}>
            {t("upgrade_description")}
          </p>
          <UpgradePrompt feature="slaTrackedHitlQueue" variant="inline" />
        </div>
      )}
    </div>
  );
}

function EscalationDetailPanel({
  selectedItem,
  actors,
  hasManagedHitl,
  crossSurfaceIdentity,
  currentTime,
  formatActorId,
  onClaimed,
  onResolved,
}: {
  selectedItem: GatewayEscalationQueueItem;
  actors: EscalationQueueViewProps["actors"];
  hasManagedHitl: boolean;
  crossSurfaceIdentity: boolean;
  currentTime: number;
  formatActorId: (id: string) => string;
  onClaimed: () => void;
  onResolved: () => void;
}) {
  const t = useTranslations("escalations.detail");

  return (
    <div
      className="panel"
      style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}
    >
      <EscalationDetailHeader
        selectedItem={selectedItem}
        currentTime={currentTime}
        formatActorId={formatActorId}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: 0 }} />

      <EscalationContextDetails
        selectedItem={selectedItem}
        crossSurfaceIdentity={crossSurfaceIdentity}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: 0 }} />

      <EscalationAssignmentSection
        selectedItem={selectedItem}
        hasManagedHitl={hasManagedHitl}
        formatActorId={formatActorId}
        onClaimed={onClaimed}
      />

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: 0 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 className="metadata">{t("resolve_title")}</h3>
        <ResolveForm queueId={selectedItem.id} onResolved={onResolved} />
      </div>
    </div>
  );
}

export function EscalationQueueView({
  initialQueue,
  initialLoadFailed = false,
  actors,
  hasManagedHitl,
  crossSurfaceIdentity,
  appViewMode,
  workspaceEyebrow,
  onboardingBanner,
}: EscalationQueueViewProps) {
  const t = useTranslations("escalations");
  const [queue, setQueue] = useState<GatewayEscalationQueueItem[]>(initialQueue);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(initialQueue[0]?.id || null);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);

  // A failed refresh must not read as "nothing to action". The route answers
  // 503 when the queue read fails, so a non-ok response is tracked and shown
  // rather than leaving the last good queue on screen as if it were current.
  const fetchQueue = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/gateway/escalations", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.queue)) {
          setQueue(data.queue);
          setLoadFailed(false);
        }
      } else {
        setLoadFailed(true);
      }
    } catch (err) {
      console.error("Failed to fetch escalations queue:", err);
      setLoadFailed(true);
    } finally {
      setIsRefreshing(false);
      setLastRefreshedAt(Date.now());
    }
  }, []);

  // Poll for new escalations every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      fetchQueue();
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchQueue]);

  // SLA live update interval (1s)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync selectedId when queue updates
  useEffect(() => {
    if (queue.length > 0) {
      if (!selectedId || !queue.some((item) => item.id === selectedId)) {
        setSelectedId(queue[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [queue, selectedId]);

  const actorEmails = new Map(actors.map((a) => [a.id, a.email]));
  const formatActorId = (id: string) => actorEmails.get(id) ?? id;
  const selectedItem = queue.find((item) => item.id === selectedId);

  return (
    <>
      <section className="topbar">
        <div>
          {workspaceEyebrow && <p className="eyebrow">{workspaceEyebrow}</p>}
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {t("title")}
            {queue.length > 0 && (
              <span className="pill pillWarn" style={{ fontSize: 13 }}>
                {t("open_count", { count: queue.length })}
              </span>
            )}
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* With a queue on screen, a failed refresh means the list is stale
              rather than empty — say so instead of silently keeping it. */}
          {loadFailed && queue.length > 0 && (
            <span className="pill pillBlock" style={{ fontSize: 12 }}>
              {t("load_error.stale")}
            </span>
          )}
          <span className="meta" style={{ fontSize: 12 }}>
            {refreshedAgoLabel(currentTime, lastRefreshedAt)}
          </span>
          <button
            onClick={fetchQueue}
            disabled={isRefreshing}
            className="btn btnSecondary btnSmall"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
            {isRefreshing ? t("refreshing") : t("refresh")}
          </button>
        </div>
      </section>

      {onboardingBanner}

      {queue.length === 0 && loadFailed ? (
        <section className="panel">
          <div className="emptyState">
            <AlertTriangle size={20} className="sectionIcon" />
            <h3>{t("load_error.title")}</h3>
            <p className="meta">{t("load_error.description")}</p>
          </div>
        </section>
      ) : queue.length === 0 ? (
        <section className="panel">
          <div className="emptyState">
            <CheckCircle2 size={20} className="sectionIcon" />
            <h3>{t("empty.title")}</h3>
            <p className="meta">
              {t.rich("empty.description", {
                post: (chunks) => <code>{chunks}</code>,
                decision: (chunks) => <code>{chunks}</code>,
                notes: (chunks) => <code>{chunks}</code>,
              })}
            </p>
          </div>
        </section>
      ) : (
        <div className="escalationsLayout">
          {/* Left Column: Master Queue List */}
          <div
            className="panel"
            style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--line)" }}>
              <p className="eyebrow">{t("queue.eyebrow")}</p>
              <h2 style={{ fontSize: 15, marginTop: 2 }}>{t("queue.title")}</h2>
            </div>

            <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 240px)" }}>
              {queue.map((item) => (
                <QueueListItem
                  key={item.id}
                  item={item}
                  isSelected={item.id === selectedId}
                  onSelect={setSelectedId}
                  appViewMode={appViewMode}
                  currentTime={currentTime}
                />
              ))}
            </div>
          </div>

          {/* Right Column: Detail / Resolution Panel */}
          {selectedItem ? (
            <EscalationDetailPanel
              selectedItem={selectedItem}
              actors={actors}
              hasManagedHitl={hasManagedHitl}
              crossSurfaceIdentity={crossSurfaceIdentity}
              currentTime={currentTime}
              formatActorId={formatActorId}
              onClaimed={fetchQueue}
              onResolved={() => {
                setQueue((prev) => prev.filter((q) => q.id !== selectedItem.id));
                setLastRefreshedAt(Date.now());
              }}
            />
          ) : (
            <div
              className="panel"
              style={{ display: "grid", placeItems: "center", padding: 48, minHeight: 300 }}
            >
              <p className="meta">{t("select_prompt")}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
