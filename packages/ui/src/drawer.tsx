import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./utils";

interface DrawerProps extends HTMLAttributes<HTMLElement> {
  open: boolean;
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  body: ReactNode;
}

export function Drawer({ open, title, eyebrow, actions, body, className, ...props }: DrawerProps) {
  if (!open) return null;
  return (
    <section className={cx("slideOutPanel", className)} role="dialog" aria-modal="true" {...props}>
      <header className="slideOutHeader">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions}
      </header>
      <div className="slideOutBody">{body}</div>
    </section>
  );
}
