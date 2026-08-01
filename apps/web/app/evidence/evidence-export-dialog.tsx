"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";

const exportOptions = [
  {
    href: "/api/evidence/export?format=csv",
    title: "Download evidence as CSV",
    label: "CSV",
    description: "Spreadsheet-ready rows for filtering, review, and handoff."
  },
  {
    href: "/api/evidence/export?format=json",
    title: "Download evidence as JSON",
    label: "JSON",
    description: "Full evidence packet with structured records and metadata."
  },
  {
    href: "/api/evidence/export?format=agt-verification",
    title: "Download evidence for AGT verification",
    label: "AGT Verify",
    description: "Verification packet for AGT-compatible evidence checks."
  }
];

export function EvidenceExportDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')];
        const first = focusable[0]; const last = focusable.at(-1);
        if (first && last) {
          // Index-based wrap also covers focus sitting on the dialog container
          // (index -1), so the first Tab/shift-Tab cannot escape the dialog.
          const index = focusable.indexOf(document.activeElement as HTMLElement);
          if (event.shiftKey && index <= 0) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) { event.preventDefault(); first.focus(); }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        className="button"
        onClick={() => setOpen(true)}
        title="Export evidence"
        type="button"
      >
        <Download size={16} />
        Export
      </button>

      {open ? (
        <div className="exportDialogLayer" role="presentation">
          <button
            aria-label="Close export dialog"
            className="exportDialogOverlay"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div
            aria-labelledby="evidence-export-title"
            aria-modal="true"
            className="exportDialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="exportDialogHeader">
              <div>
                <p className="eyebrow">Evidence export</p>
                <h2 id="evidence-export-title">Select format</h2>
              </div>
              <button
                aria-label="Close export dialog"
                className="iconButton"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={17} />
              </button>
            </header>

            <div className="exportDialogOptions">
              {exportOptions.map((option) => (
                <a
                  className="exportDialogOption"
                  href={option.href}
                  key={option.href}
                  onClick={() => setOpen(false)}
                  title={option.title}
                >
                  <span className="exportDialogOptionIcon">
                    <FileText size={17} />
                  </span>
                  <span className="exportDialogOptionCopy">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </span>
                  <Download size={16} className="exportDialogOptionAction" />
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
