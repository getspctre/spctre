import React from "react";

interface SettingsHeaderProps {
  /** Scope-qualified section label, e.g. "Administration · Workflows". */
  eyebrow: React.ReactNode;
  /** Page title rendered as the h1. */
  title: React.ReactNode;
  /** Optional one-line description rendered as meta text under the title. */
  description?: React.ReactNode;
  /** Optional trailing controls (pills, buttons) rendered in the toolbar slot. */
  actions?: React.ReactNode;
}

/**
 * Canonical header for every settings-surface page reachable from the top-nav
 * settings menu (account, workspace, administration, organization). Keeps the
 * topbar / eyebrow / h1 markup identical across pages so they read as one system.
 */
export function SettingsHeader({ eyebrow, title, description, actions }: SettingsHeaderProps) {
  return (
    <section className="topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="meta">{description}</p> : null}
      </div>
      {actions ? <div className="toolbar">{actions}</div> : null}
    </section>
  );
}
