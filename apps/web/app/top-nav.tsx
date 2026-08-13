"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, AlertTriangle, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { logoutControlPlane } from "./auth-actions";
import {
  setActiveTenant,
  setActiveWorkspace,
  type TenantSwitchState,
  type WorkspaceSwitchState,
} from "./workspace-actions";
import { useActionState } from "react";
import type { TenantSummary, WorkspaceSummary } from "@/lib/workspace/types";
import { buildWorkspacePath, buildWorkspaceSwitchPath } from "@/lib/workspace/path";
import { APP_VIEW_MODE_COOKIE, type AppViewMode } from "@/lib/app-view-mode";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useFeatureFlag } from "./feature-flags";
import { useTranslations } from "next-intl";

interface TopNavProps {
  tenantLabel: string;
  activeTenantId: string;
  tenantOptions: TenantSummary[];
  workspaceLabel: string;
  activeWorkspaceId: string;
  workspaceOptions: WorkspaceSummary[];
  activePrincipalName?: string;
  activePrincipalEmail?: string | null;
  signedIn: boolean;
  isAdmin: boolean;
  escalationCount?: number;
  initialViewMode: AppViewMode;
}

const PAGE_LABEL_KEYS: Record<string, string> = {
  "": "policies",
  rules: "rules",
  review: "review",
  evidence: "audit_log",
  agents: "agents",
  "escalation-routing": "escalation_routing",
  "siem-export": "siem_export",
  compliance: "compliance_report",
  packs: "packs",
  operations: "audit_ledger",
  escalations: "escalations",
  "usage-billing": "usage_billing",
  account: "account",
  admin: "admin",
};

function getPageLabel(
  pathname: string,
  workspaceSlug: string,
  t: (key: string) => string,
): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const afterWorkspace = segments[0] === workspaceSlug ? segments.slice(1) : segments;
  const section = afterWorkspace[0] ?? "";
  const key = PAGE_LABEL_KEYS[section];
  return key ? t(key) : null;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (!parts.length) return "U";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function WorkspaceSwitcherMenu({
  canSwitchTenants,
  tenantAction,
  tenantState,
  workspaceAction,
  workspaceState,
  activeTenantId,
  activeWorkspaceId,
  tenantOptions,
  filteredWorkspaces,
  workspaceQuery,
  setWorkspaceQuery,
  closeMenu,
  usageBillingHref,
}: {
  canSwitchTenants: boolean;
  tenantAction: (formData: FormData) => void;
  tenantState: { error?: string } | null;
  workspaceAction: (formData: FormData) => void;
  workspaceState: { error?: string } | null;
  activeTenantId: string;
  activeWorkspaceId: string;
  tenantOptions: TenantSummary[];
  filteredWorkspaces: WorkspaceSummary[];
  workspaceQuery: string;
  setWorkspaceQuery: (value: string) => void;
  closeMenu: () => void;
  usageBillingHref: string;
}) {
  return (
    <div className="topNavWorkspaceMenu">
      <p className="meta">
        {canSwitchTenants ? "Switch tenant and workspace" : "Switch workspace"}
      </p>
      {canSwitchTenants ? (
        <>
          <label className="workspaceFieldLabel" htmlFor="topnav-tenant-select">
            Tenant
          </label>
          <form action={tenantAction} className="topNavWorkspaceForm">
            <select
              id="topnav-tenant-select"
              className="input topNavTenantSelect"
              name="tenantId"
              defaultValue={activeTenantId}
              onChange={(event) => {
                event.currentTarget.form?.requestSubmit();
              }}
            >
              {tenantOptions.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.slug}
                </option>
              ))}
            </select>
          </form>
          {tenantState?.error ? <p className="meta workspaceError">{tenantState.error}</p> : null}
        </>
      ) : tenantOptions.length > 1 ? (
        <div className="topNavGatePrompt">
          <strong>{FEATURE_FLAGS.multiTenantWorkspaceIsolation.label}</strong>
          <p className="meta">{FEATURE_FLAGS.multiTenantWorkspaceIsolation.description}</p>
          <a className="button" href={usageBillingHref}>
            View plans
          </a>
        </div>
      ) : null}

      <label className="workspaceFieldLabel" htmlFor="topnav-workspace-search">
        Workspace
      </label>
      <input
        id="topnav-workspace-search"
        className="input topNavWorkspaceSearch"
        type="search"
        value={workspaceQuery}
        onChange={(event) => setWorkspaceQuery(event.currentTarget.value)}
        placeholder="Search workspaces"
        aria-label="Search workspaces"
        autoComplete="off"
      />
      <div className="topNavWorkspaceList" aria-label="Available workspaces">
        {filteredWorkspaces.map((workspace) => {
          const active = workspace.id === activeWorkspaceId;
          return (
            <form action={workspaceAction} key={workspace.id}>
              <input name="workspaceId" type="hidden" value={workspace.id} />
              <button
                aria-current={active ? "page" : undefined}
                className={active ? "topNavWorkspaceOption isActive" : "topNavWorkspaceOption"}
                type="submit"
              >
                <strong>{workspace.name}</strong>
                <span>{workspace.slug}</span>
              </button>
            </form>
          );
        })}
      </div>
      {workspaceQuery && !filteredWorkspaces.length ? (
        <p className="meta workspaceHint">No workspaces match that search.</p>
      ) : null}
      {workspaceState?.error ? <p className="meta workspaceError">{workspaceState.error}</p> : null}
    </div>
  );
}

function UserDropdown({
  signedIn,
  displayName,
  activePrincipalEmail,
  isAdmin,
  usageBillingHref,
  escalationRoutingHref,
  siemExportHref,
}: {
  signedIn: boolean;
  displayName: string;
  activePrincipalEmail?: string | null;
  isAdmin: boolean;
  usageBillingHref: string;
  escalationRoutingHref: string;
  siemExportHref: string;
}) {
  return (
    <div className="topNavDropdown" role="menu">
      {signedIn ? (
        <>
          <div className="topNavIdentity">
            <p className="meta">Signed in as</p>
            <strong>{displayName}</strong>
            {activePrincipalEmail ? <span className="meta">{activePrincipalEmail}</span> : null}
          </div>

          <section className="topNavMenuGroup" aria-label="Your account">
            <p className="topNavMenuGroupTitle">Your account</p>
            <Link className="topNavAction" href="/account" role="menuitem">
              Account and security
            </Link>
          </section>

          <section className="topNavMenuGroup" aria-label="Workspace">
            <p className="topNavMenuGroupTitle">Workspace</p>
            <Link className="topNavAction" href={usageBillingHref} role="menuitem">
              Usage &amp; billing
            </Link>
          </section>

          {isAdmin ? (
            <>
              <section className="topNavMenuGroup" aria-label="Workspace administration">
                <p className="topNavMenuGroupTitle">Workspace administration</p>
                <Link className="topNavAction" href="/admin/workspace" role="menuitem">
                  Workspace settings
                </Link>
                <Link className="topNavAction" href="/admin/localization" role="menuitem">
                  Terminology &amp; branding
                </Link>
                <Link className="topNavAction" href="/admin/workflows" role="menuitem">
                  Approval workflows
                </Link>
                <Link className="topNavAction" href={escalationRoutingHref} role="menuitem">
                  Escalation routing
                </Link>
                <Link className="topNavAction" href={siemExportHref} role="menuitem">
                  SIEM export
                </Link>
                <Link className="topNavAction" href="/admin/service-keys" role="menuitem">
                  API service keys
                </Link>
                <Link
                  className="topNavAction"
                  href="/admin/publication-signing-keys"
                  role="menuitem"
                >
                  Publication signing keys
                </Link>
                <Link className="topNavAction" href="/admin/webhooks" role="menuitem">
                  Gateway webhooks
                </Link>
              </section>

              <section className="topNavMenuGroup" aria-label="Organization administration">
                <p className="topNavMenuGroupTitle">Organization</p>
                <Link className="topNavAction" href="/admin/members" role="menuitem">
                  Members &amp; roles
                </Link>
                <Link className="topNavAction" href="/admin/auth" role="menuitem">
                  Auth settings
                </Link>
              </section>
            </>
          ) : null}

          <section className="topNavMenuGroup" aria-label="Session actions">
            <p className="topNavMenuGroupTitle">Session</p>
            <form action={logoutControlPlane}>
              <button className="topNavAction" type="submit">
                Sign out
              </button>
            </form>
          </section>
        </>
      ) : (
        <Link className="topNavAction" href="/login" role="menuitem">
          Sign in
        </Link>
      )}
    </div>
  );
}

// Close open menus on outside pointer-down or Escape.
function useMenuDismissal(
  open: boolean,
  workspaceOpen: boolean,
  menuRef: React.RefObject<HTMLDivElement | null>,
  workspaceMenuRef: React.RefObject<HTMLDivElement | null>,
  setOpen: (value: boolean) => void,
  setWorkspaceOpen: (value: boolean) => void,
) {
  useEffect(() => {
    if (!open && !workspaceOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (open && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
      if (
        workspaceOpen &&
        workspaceMenuRef.current &&
        !workspaceMenuRef.current.contains(event.target as Node)
      ) {
        setWorkspaceOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setWorkspaceOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open, workspaceOpen]);
}

// Workspace-scoped hrefs and the breadcrumb page label for the current path.
function deriveNavContext(
  pathname: string,
  workspaceOptions: WorkspaceSummary[],
  activeWorkspaceId: string,
  t: (key: string) => string,
) {
  const pathnameSegments = pathname.split("/").filter(Boolean);
  const pathWorkspace = workspaceOptions.find((w) => w.slug === pathnameSegments[0]);
  const activeWorkspace = pathWorkspace ?? workspaceOptions.find((w) => w.id === activeWorkspaceId);
  return {
    escalationsHref: activeWorkspace
      ? buildWorkspacePath(activeWorkspace.slug, "/escalations")
      : "/escalations",
    escalationRoutingHref: activeWorkspace
      ? buildWorkspacePath(activeWorkspace.slug, "/escalation-routing")
      : "/escalation-routing",
    siemExportHref: activeWorkspace
      ? buildWorkspacePath(activeWorkspace.slug, "/siem-export")
      : "/siem-export",
    usageBillingHref: activeWorkspace
      ? buildWorkspacePath(activeWorkspace.slug, "/usage-billing")
      : "/usage-billing",
    pageLabel: getPageLabel(pathname, activeWorkspace?.slug ?? "", t),
  };
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: AppViewMode;
  onChange: (mode: AppViewMode) => void;
}) {
  return (
    <div className="topNavViewMode" aria-label="Application view mode">
      <button
        aria-pressed={viewMode === "executive"}
        data-active={viewMode === "executive" ? "true" : undefined}
        onClick={() => onChange("executive")}
        title="Use executive view across the application"
        type="button"
      >
        Executive
      </button>
      <button
        aria-pressed={viewMode === "forensic"}
        data-active={viewMode === "forensic" ? "true" : undefined}
        onClick={() => onChange("forensic")}
        title="Use forensic view across the application"
        type="button"
      >
        Forensic
      </button>
    </div>
  );
}

/**
 * Rewrites the URL to the newly selected workspace after a switch, keeping the
 * equivalent scoped route and query. Runs only for a fresh switch action:
 * workspaceState persists across navigations (TopNav lives in the layout and
 * never remounts), so without the ref guard the effect would re-fire on every
 * later navigation and bounce the user off global routes (e.g. /admin) back to
 * the workspace home.
 */
function useWorkspaceSwitchRedirect(
  workspaceState: WorkspaceSwitchState,
  workspaceOptions: WorkspaceSummary[],
) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const handledWorkspaceState = useRef<WorkspaceSwitchState>(null);

  useEffect(() => {
    if (!workspaceState || "error" in workspaceState) return;
    if (handledWorkspaceState.current === workspaceState) return;
    handledWorkspaceState.current = workspaceState;

    const workspace = workspaceOptions.find((option) => option.id === workspaceState.workspaceId);
    if (!workspace) return;

    const search = searchParams.toString();
    const nextPath = buildWorkspaceSwitchPath({
      workspaceSlug: workspace.slug,
      pathname,
      search,
      knownWorkspaceSlugs: workspaceOptions.map((option) => option.slug),
    });
    const currentPath = `${pathname}${search ? `?${search}` : ""}`;
    if (nextPath !== currentPath) router.replace(nextPath);
  }, [pathname, router, searchParams, workspaceOptions, workspaceState]);
}

function useTenantSwitchRedirect(tenantState: TenantSwitchState) {
  const router = useRouter();
  const handledTenantState = useRef<TenantSwitchState>(null);
  useEffect(() => {
    if (!tenantState || "error" in tenantState || handledTenantState.current === tenantState)
      return;
    handledTenantState.current = tenantState;
    // When the target tenant requires MFA, leave the user in place: the root
    // layout re-renders the MFA gate (revalidatePath already fired), so pushing
    // into the new workspace would only bounce off that gate.
    if (tenantState.requiresMfa) return;
    router.replace(tenantState.workspaceSlug ? `/${tenantState.workspaceSlug}` : "/");
  }, [router, tenantState]);
}

export function TopNav({
  tenantLabel,
  activeTenantId,
  tenantOptions,
  workspaceLabel,
  activeWorkspaceId,
  workspaceOptions,
  activePrincipalName,
  activePrincipalEmail,
  signedIn,
  isAdmin,
  escalationCount,
  initialViewMode,
}: TopNavProps) {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [viewMode, setViewMode] = useState<AppViewMode>(initialViewMode);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const [tenantState, tenantAction, tenantPending] = useActionState(setActiveTenant, null);
  const [workspaceState, workspaceAction, workspacePending] = useActionState(
    setActiveWorkspace,
    null,
  );
  const canSwitchTenants = useFeatureFlag("multiTenantWorkspaceIsolation");

  useMenuDismissal(open, workspaceOpen, menuRef, workspaceMenuRef, setOpen, setWorkspaceOpen);

  const displayName = activePrincipalName?.trim() || "Unknown";
  const initials = useMemo(() => initialsFromName(displayName), [displayName]);
  const { escalationsHref, escalationRoutingHref, siemExportHref, usageBillingHref, pageLabel } =
    deriveNavContext(pathname, workspaceOptions, activeWorkspaceId, t);
  const escalationsActive = pathname.includes("/escalations");
  const hasOpenEscalations = escalationCount != null && escalationCount > 0;

  function updateViewMode(nextMode: AppViewMode) {
    setViewMode(nextMode);
    document.cookie = `${APP_VIEW_MODE_COOKIE}=${nextMode}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceQuery.trim().toLowerCase();
    if (!query) return workspaceOptions;

    return workspaceOptions.filter((workspace) => {
      return (
        workspace.slug.toLowerCase().includes(query) || workspace.name.toLowerCase().includes(query)
      );
    });
  }, [workspaceOptions, workspaceQuery]);

  useWorkspaceSwitchRedirect(workspaceState, workspaceOptions);
  useTenantSwitchRedirect(tenantState);

  return (
    <header className="topNav">
      <div className="topNavContext" ref={workspaceMenuRef}>
        <p className="topNavEyebrow">Workspace context</p>
        <button
          type="button"
          className="topNavCrumbButton"
          aria-expanded={workspaceOpen ? "true" : "false"}
          onClick={() => setWorkspaceOpen((value) => !value)}
          title="Switch tenant or workspace"
          disabled={workspacePending || tenantPending}
        >
          <span className="topNavCrumbTenant">{tenantLabel}</span>
          <span className="topNavCrumbSlash">/</span>
          <span className="topNavCrumbWorkspace">{workspaceLabel}</span>
          {pageLabel ? (
            <>
              <ChevronRight size={12} className="topNavCrumbChevron" />
              <strong className="topNavCrumbPage">{pageLabel}</strong>
            </>
          ) : null}
          {workspacePending || tenantPending ? (
            <span className="meta" style={{ fontSize: 11 }}>
              Switching…
            </span>
          ) : (
            <ChevronDown size={12} className="topNavCrumbChevron" />
          )}
        </button>

        {workspaceOpen ? (
          <WorkspaceSwitcherMenu
            canSwitchTenants={canSwitchTenants}
            tenantAction={tenantAction}
            tenantState={tenantState}
            workspaceAction={workspaceAction}
            workspaceState={workspaceState}
            activeTenantId={activeTenantId}
            activeWorkspaceId={activeWorkspaceId}
            tenantOptions={tenantOptions}
            filteredWorkspaces={filteredWorkspaces}
            workspaceQuery={workspaceQuery}
            setWorkspaceQuery={setWorkspaceQuery}
            closeMenu={() => setWorkspaceOpen(false)}
            usageBillingHref={usageBillingHref}
          />
        ) : null}
      </div>

      <nav className="topNavGlobalNav">
        <p className="topNavEyebrow">Controls</p>
        <Link
          href={escalationsHref}
          className="topNavLink"
          data-active={escalationsActive ? "true" : undefined}
          data-alert={hasOpenEscalations ? "true" : undefined}
          title={
            hasOpenEscalations ? `${escalationCount} open escalations` : "View pending escalations"
          }
        >
          <AlertTriangle size={16} />
          <span>{hasOpenEscalations ? "Open escalations" : "Escalations"}</span>
          {hasOpenEscalations ? <span className="topNavBadge">{escalationCount}</span> : null}
        </Link>
        <ViewModeToggle viewMode={viewMode} onChange={updateViewMode} />
      </nav>

      <div className="topNavMenu" ref={menuRef}>
        <button
          aria-expanded={open ? "true" : "false"}
          aria-haspopup="menu"
          className="topNavUserButton"
          onClick={() => setOpen((value) => !value)}
          title={displayName}
          type="button"
        >
          <span className="topNavAvatar">{initials}</span>
          <ChevronDown size={12} />
        </button>

        {open ? (
          <UserDropdown
            signedIn={signedIn}
            displayName={displayName}
            activePrincipalEmail={activePrincipalEmail}
            isAdmin={isAdmin}
            usageBillingHref={usageBillingHref}
            escalationRoutingHref={escalationRoutingHref}
            siemExportHref={siemExportHref}
          />
        ) : null}
      </div>
    </header>
  );
}
