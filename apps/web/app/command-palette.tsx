"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X, Bot, GitBranch, Activity, SquareCheck, ScrollText, PackageCheck, Boxes, AlertTriangle, CreditCard } from "lucide-react";
import { buildWorkspacePath } from "@/lib/workspace/path";

interface CommandItem {
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  keywords: string[];
}

function buildItems(workspaceSlug: string, t: (key: string) => string): CommandItem[] {
  const p = (path: string) => buildWorkspacePath(workspaceSlug, path);
  return [
    { label: t("items.policies.label"), description: t("items.policies.description"), href: p("/"), icon: <GitBranch size={15} />, keywords: ["branch", "import", "policy"] },
    { label: t("items.rules.label"), description: t("items.rules.description"), href: p("/rules"), icon: <Search size={15} />, keywords: ["rule", "deny", "warn", "allow", "connector"] },
    { label: t("items.review.label"), description: t("items.review.description"), href: p("/review"), icon: <SquareCheck size={15} />, keywords: ["review", "publish", "compose", "diff"] },
    { label: t("items.audit_log.label"), description: t("items.audit_log.description"), href: p("/evidence"), icon: <Activity size={15} />, keywords: ["evidence", "audit", "log", "decision", "simulation"] },
    { label: t("items.agents.label"), description: t("items.agents.description"), href: p("/agents"), icon: <Bot size={15} />, keywords: ["agent", "fleet", "stale", "outdated", "current"] },
    { label: t("items.compliance.label"), description: t("items.compliance.description"), href: p("/compliance"), icon: <PackageCheck size={15} />, keywords: ["compliance", "report", "export", "timeline", "seal", "retention"] },
    { label: t("items.packs.label"), description: t("items.packs.description"), href: p("/packs"), icon: <Boxes size={15} />, keywords: ["pack", "install", "catalog"] },
    { label: t("items.audit_ledger.label"), description: t("items.audit_ledger.description"), href: p("/operations"), icon: <ScrollText size={15} />, keywords: ["operations", "audit", "ledger", "log", "hash", "chain"] },
    { label: t("items.escalations.label"), description: t("items.escalations.description"), href: p("/escalations"), icon: <AlertTriangle size={15} />, keywords: ["escalation", "hitl", "review", "sla", "queue"] },
    { label: t("items.escalation_routing.label"), description: t("items.escalation_routing.description"), href: p("/escalation-routing"), icon: <AlertTriangle size={15} />, keywords: ["routing", "notification", "pagerduty", "slack", "teams"] },
    { label: t("items.siem_export.label"), description: t("items.siem_export.description"), href: p("/siem-export"), icon: <ScrollText size={15} />, keywords: ["siem", "splunk", "sentinel", "export", "stream"] },
    { label: t("items.billing.label"), description: t("items.billing.description"), href: "/usage-billing", icon: <CreditCard size={15} />, keywords: ["billing", "plan", "usage", "subscription"] },
  ];
}

function extractWorkspaceSlug(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] ?? "default";
}

interface CommandPaletteProps {
  workspaceSlug?: string;
}

export function CommandPalette({ workspaceSlug }: CommandPaletteProps) {
  const t = useTranslations("command_palette");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const slug = workspaceSlug ?? extractWorkspaceSlug(pathname);
  const items = buildItems(slug, t);

  const filtered = query.trim()
    ? items.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.includes(q))
        );
      })
    : items;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  function navigate(href: string) {
    router.push(href);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      navigate(filtered[activeIndex].href);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="cmdPaletteLayer" role="presentation">
      <button
        aria-label={t("close_palette")}
        className="cmdPaletteOverlay"
        onClick={() => setOpen(false)}
        type="button"
      />
      <div
        className="cmdPaletteModal"
        role="dialog"
        aria-label={t("aria_label")}
        aria-modal="true"
      >
        <div className="cmdPaletteSearch">
          <Search size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cmdPaletteInput"
            type="text"
            placeholder={t("placeholder")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            aria-label={t("search_aria_label")}
            aria-controls="cmd-palette-list"
            aria-activedescendant={filtered[activeIndex] ? `cmd-item-${activeIndex}` : undefined}
          />
          <button
            aria-label={t("close")}
            className="cmdPaletteClose"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        {filtered.length > 0 ? (
          <ul id="cmd-palette-list" className="cmdPaletteList" ref={listRef} role="listbox">
            {filtered.map((item, i) => (
              <li key={item.href} role="option" aria-selected={i === activeIndex}>
                <button
                  id={`cmd-item-${i}`}
                  className="cmdPaletteItem"
                  data-active={i === activeIndex ? "true" : undefined}
                  onClick={() => navigate(item.href)}
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="cmdPaletteItemIcon">{item.icon}</span>
                  <span className="cmdPaletteItemText">
                    <span className="cmdPaletteItemLabel">{item.label}</span>
                    <span className="cmdPaletteItemDesc">{item.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cmdPaletteEmpty">{t("no_results", { query })}</p>
        )}

        <div className="cmdPaletteFooter">
          <span><kbd>↑↓</kbd> {t("footer.navigate")}</span>
          <span><kbd>↵</kbd> {t("footer.open")}</span>
          <span><kbd>Esc</kbd> {t("footer.close")}</span>
          <span style={{ marginLeft: "auto" }}><kbd>⌘K</kbd> {t("footer.toggle")}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
