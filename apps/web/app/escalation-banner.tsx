"use client";

import { AlertTriangle, ChevronRight, Clock3, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

interface EscalationBannerItem {
  id: string;
  decisionId: string;
  status: string;
  slaDueAt: string;
  connector?: string;
  action?: string;
  riskLevel?: string;
  assignedTo?: string;
}

interface EscalationBannerProps {
  count: number;
  escalationsHref: string;
  items: EscalationBannerItem[];
}

function getSlaState(slaDueAt: string, now: number): "overdue" | "soon" | "normal" {
  const msUntilDue = new Date(slaDueAt).getTime() - now;
  if (msUntilDue < 0) return "overdue";
  if (msUntilDue < 60 * 60 * 1000) return "soon";
  return "normal";
}

function formatSlaLabel(slaDueAt: string, now: number): string {
  const msUntilDue = new Date(slaDueAt).getTime() - now;
  const absMs = Math.abs(msUntilDue);
  const minutes = Math.max(1, Math.round(absMs / 60000));
  const hours = Math.round(minutes / 60);

  if (msUntilDue < 0) {
    if (minutes < 60) return `${minutes}m overdue`;
    return `${hours}h overdue`;
  }

  if (minutes < 60) return `in ${minutes}m`;
  return `in ${hours}h`;
}

function compactDecisionId(decisionId: string): string {
  if (decisionId.length <= 14) return decisionId;
  return `${decisionId.slice(0, 7)}...${decisionId.slice(-4)}`;
}

export function EscalationBanner({ count, escalationsHref, items }: EscalationBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pathname = usePathname();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const nearestItem = items[0];
  const nearestSlaLabel = nearestItem ? formatSlaLabel(nearestItem.slaDueAt, now) : null;
  const hasOverdue = items.some((item) => getSlaState(item.slaDueAt, now) === "overdue");
  const hiddenByDismissal = dismissed && !hasOverdue;
  const isEscalationsPage = pathname?.endsWith("/escalations");

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime()
      ),
    [items]
  );

  if (count === 0 || isEscalationsPage || hiddenByDismissal) return null;

  return (
    <>
      <div className="escalationBanner" role="alert" aria-live="polite">
        <AlertTriangle className="escalationBannerIcon" size={16} />
        <button
          className="escalationBannerSummary"
          onClick={() => setDrawerOpen(true)}
          type="button"
        >
          <span>
            <strong>{count} escalation{count === 1 ? "" : "s"} pending</strong>
            {nearestSlaLabel ? `, nearest SLA ${nearestSlaLabel}` : ", agents are waiting for review"}
          </span>
          <span className="escalationBannerInspect">
            Inspect
            <ChevronRight size={14} />
          </span>
        </button>
        <a className="escalationBannerLink" href={escalationsHref}>
          Open queue
        </a>
        <button
          aria-label="Dismiss escalation alert"
          className="escalationBannerDismiss"
          disabled={hasOverdue}
          onClick={() => setDismissed(true)}
          title={hasOverdue ? "Overdue escalations cannot be dismissed." : "Dismiss escalation alert"}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {drawerOpen ? (
        <div className="escalationDrawerLayer">
          <button
            aria-label="Close escalation drawer"
            className="escalationDrawerOverlay"
            onClick={() => setDrawerOpen(false)}
            type="button"
          />
          <aside className="escalationDrawer" aria-label="Open escalations">
            <header className="escalationDrawerHeader">
              <div>
                <p className="eyebrow">Escalations</p>
                <h2>{count} pending review{count === 1 ? "" : "s"}</h2>
                {nearestSlaLabel ? (
                  <p className="meta">Nearest SLA {nearestSlaLabel}.</p>
                ) : null}
              </div>
              <button
                aria-label="Close escalation drawer"
                className="iconButton"
                onClick={() => setDrawerOpen(false)}
                type="button"
              >
                <X size={16} />
              </button>
            </header>

            <div className="escalationDrawerBody">
              {sortedItems.length ? (
                sortedItems.map((item) => {
                  const slaState = getSlaState(item.slaDueAt, now);
                  const title = [item.connector, item.action].filter(Boolean).join(".") || "runtime decision";
                  return (
                    <article className="escalationDrawerItem" key={item.id} data-sla={slaState}>
                      <div className="rowHeader">
                        <div>
                          <h3>{title}</h3>
                          <p className="meta">{compactDecisionId(item.decisionId)}</p>
                        </div>
                        <span className={slaState === "overdue" ? "pill pillBlock" : slaState === "soon" ? "pill pillWarn" : "pill pillAllow"}>
                          {formatSlaLabel(item.slaDueAt, now)}
                        </span>
                      </div>
                      <div className="escalationDrawerMeta">
                        <span>{item.status}</span>
                        <span>{item.riskLevel ?? "unscored"}</span>
                        <span>{item.assignedTo ? "Assigned" : "Unassigned"}</span>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="emptyState">
                  <Clock3 size={18} className="sectionIcon" />
                  <h3>Queue details unavailable</h3>
                  <p className="meta">Open the queue to refresh escalation details.</p>
                </div>
              )}
            </div>

            <footer className="escalationDrawerFooter">
              <a className="button buttonPrimary" href={escalationsHref}>
                Open escalation queue
              </a>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
