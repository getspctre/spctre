"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface SlideOutPanelProps {
  title: string;
  eyebrow?: string;
  description?: string;
  defaultOpen?: boolean;
  width?: "standard" | "wide";
  trigger: (controls: { open: () => void; triggerId: string }) => React.ReactNode;
  children: React.ReactNode;
}

export function SlideOutPanel({
  title,
  eyebrow,
  description,
  defaultOpen = false,
  width = "standard",
  trigger,
  children
}: SlideOutPanelProps) {
  const t = useTranslations("shared.slide_out");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const titleId = useId();
  const descriptionId = useId();
  const triggerId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const FOCUSABLE = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])'
    ].join(", ");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }
      if (event.key === "Tab" && panelRef.current) {
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  return (
    <>
      {trigger({ open: () => setIsOpen(true), triggerId })}

      {isOpen ? (
        <div className="slideOutLayer" role="presentation">
          <button
            aria-label={t("close")}
            className="slideOutOverlay"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <section
            aria-describedby={description ? descriptionId : undefined}
            aria-labelledby={titleId}
            aria-modal="true"
            className="slideOutPanel"
            data-width={width}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
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
              <button
                aria-label={t("close")}
                className="iconButton"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                <X size={17} />
              </button>
            </header>

            <div className="slideOutBody">{children}</div>
          </section>
        </div>
      ) : null}
    </>
  );
}
