"use client";

import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./utils";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export interface DrawerProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  width?: "standard" | "wide";
  closeLabel?: string;
}

/** A controlled, accessible slide-out dialog for inspecting or editing a record. */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  description,
  headerActions,
  children,
  width = "standard",
  closeLabel = "Close panel",
  className,
  ...props
}: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="slideOutLayer" role="presentation">
      <button aria-label={closeLabel} className="slideOutOverlay" onClick={onClose} type="button" />
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cx("slideOutPanel", className)}
        data-width={width}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        {...props}
      >
        <header className="slideOutHeader">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <p className="meta" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <div
            className="drawerHeaderActions"
            style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
          >
            {headerActions}
            <button aria-label={closeLabel} className="iconButton" onClick={onClose} type="button">
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>
        <div className="slideOutBody">{children}</div>
      </section>
    </div>
  );
}
