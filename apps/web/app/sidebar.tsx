"use client";

import { Activity, AlertTriangle, BookOpen, Bot, Boxes, ExternalLink, GitBranch, HelpCircle, PackageCheck, ScrollText, Search, SquareCheck, FileCode2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type WorkspaceSummary } from "@/lib/workspace/types";
import { buildWorkspacePath } from "@/lib/workspace/path";
import { CommandPalette } from "./command-palette";
import { BrandLogo } from "@/components/brand-logo";
import { useTranslations } from "next-intl";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
  // The workspace home (`/{slug}`) is a prefix of every scoped route, so it must
  // match exactly; all other items also light up on their sub-routes.
  exact?: boolean;
}

function NavItem({ href, icon, badge, children, exact = false }: NavItemProps) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      className="navItem"
      href={href}
      data-active={active ? "true" : undefined}
      title={typeof children === "string" ? children : undefined}
      aria-label={typeof children === "string" ? children : undefined}
      data-tooltip={typeof children === "string" ? children : undefined}
    >
      {icon}
      <span className="navItemLabel">{children}</span>
      {badge != null && badge > 0 ? <span className="navBadge">{badge}</span> : null}
    </Link>
  );
}

function CmdTrigger() {
  const t = useTranslations("sidebar");
  function openPalette() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
  }
  return (
    <button type="button" className="cmdTrigger" onClick={openPalette} title={t("open_command_palette")}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Search size={13} />
        <span>{t("go_to")}</span>
      </span>
      <span className="cmdTriggerKbd">
        <kbd>⌘</kbd><kbd>K</kbd>
      </span>
    </button>
  );
}

interface SidebarProps {
  branchCount?: number;
  escalationCount?: number;
  activeWorkspaceId: string;
  workspaceOptions: WorkspaceSummary[];
}

interface NavEntry {
  key: string;
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

export function Sidebar({
  branchCount,
  escalationCount,
  activeWorkspaceId,
  workspaceOptions,
}: SidebarProps) {
  const t = useTranslations("navigation");
  const shellT = useTranslations("sidebar");
  const pathname = usePathname();
  const pathnameSegments = pathname.split("/").filter(Boolean);
  const pathWorkspace = workspaceOptions.find((workspace) => workspace.slug === pathnameSegments[0]);
  const activeWorkspace =
    pathWorkspace ?? workspaceOptions.find((workspace) => workspace.id === activeWorkspaceId);
  const scopedHref = (path: string) =>
    activeWorkspace ? buildWorkspacePath(activeWorkspace.slug, path) : path;

  return (
    <aside className="sidebar">
      <CommandPalette workspaceSlug={activeWorkspace?.slug} />
      <div className="brand" title="Spctre">
        <span className="brandMark">
          <BrandLogo size={18} />
        </span>
        <span className="brandName">Spctre</span>
      </div>
      <nav className="nav" aria-label={shellT("primary_nav")}>
        {([
          {
            label: t("policies"),
            items: [
              { key: "policies", path: "/", label: t("policies"), icon: <GitBranch size={17} />, badge: branchCount },
              { key: "rules", path: "/rules", label: t("rules"), icon: <Search size={17} /> },
              { key: "packs", path: "/packs", label: t("packs"), icon: <Boxes size={17} /> },
              { key: "review", path: "/review", label: t("review"), icon: <SquareCheck size={17} /> },
            ],
          },
          {
            label: t("audit"),
            items: [
              { key: "evidence", path: "/evidence", label: t("audit_log"), icon: <Activity size={17} /> },
              { key: "operations", path: "/operations", label: t("audit_ledger"), icon: <ScrollText size={17} /> },
              { key: "compliance", path: "/compliance", label: t("compliance_report"), icon: <PackageCheck size={17} /> },
            ],
          },
          {
            label: t("agents"),
            items: [
              { key: "agents", path: "/agents", label: t("agents"), icon: <Bot size={17} /> },
              { key: "blueprints", path: "/blueprints", label: "Blueprints", icon: <FileCode2 size={17} /> },
              { key: "escalations", path: "/escalations", label: t("escalations"), icon: <AlertTriangle size={17} />, badge: escalationCount },
            ],
          },
        ] as NavGroup[]).map((group) => (
          <div className="navGroup" key={group.label}>
            <p className="navLabel">{group.label}</p>
            {group.items.map((item) => (
              <NavItem key={item.key} href={scopedHref(item.path)} icon={item.icon} badge={item.badge} exact={item.path === "/"}>
                {item.label}
              </NavItem>
            ))}
          </div>
        ))}
      </nav>
      <a href="/help-docs" target="_blank" rel="noopener noreferrer" className="navItem" style={{ margin: "0 14px" }} title={shellT("opens_new_tab")}>
        <HelpCircle size={17} />
        <span className="navItemLabel">{t("help_docs")} <ExternalLink size={11} style={{ opacity: 0.5, verticalAlign: "middle" }} /></span>
      </a>
      <a href="/api-docs" target="_blank" rel="noopener noreferrer" className="navItem" style={{ margin: "0 14px" }} title={shellT("opens_new_tab")}>
        <BookOpen size={17} />
        <span className="navItemLabel">{t("api_docs")} <ExternalLink size={11} style={{ opacity: 0.5, verticalAlign: "middle" }} /></span>
      </a>
      <CmdTrigger />
    </aside>
  );
}
