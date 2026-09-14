"use client";

import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./utils";

const openDrawers: HTMLElement[] = [];
let unlockedOverflow = "";

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
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;
    if (openDrawers.length === 0) unlockedOverflow = document.body.style.overflow;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    openDrawers.push(panel);
    const isTop = () => openDrawers[openDrawers.length - 1] === panel;
    const focusableElements = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
        if (element.closest("[hidden], [inert]")) return false;
        let ancestor: HTMLElement | null = element;
        while (ancestor && ancestor !== panel) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (
            ancestor.tagName === "DETAILS" &&
            !ancestor.hasAttribute("open") &&
            !ancestor.querySelector("summary")?.contains(element)
          )
            return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      });
    const focusFirst = () => (focusableElements()[0] ?? panel).focus();
    focusFirst();
    const onFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !panel.contains(event.target)) focusFirst();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (!panel.contains(document.activeElement) || document.activeElement === panel) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      openDrawers.splice(openDrawers.indexOf(panel), 1);
      if (openDrawers.length === 0) document.body.style.overflow = unlockedOverflow;
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
      previousFocusRef.current?.focus();
    };
  }, [open]);

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
