import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./utils";

type ButtonTone = "default" | "primary" | "pill" | "pill-save" | "pill-danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  leadingIcon?: ReactNode;
}

export function Button({
  tone = "default",
  className,
  leadingIcon,
  children,
  ...props
}: ButtonProps) {
  const toneClass =
    tone === "primary"
      ? "buttonPrimary"
      : tone === "pill"
        ? "buttonPill"
        : tone === "pill-save"
          ? "buttonPill buttonPillSave"
          : tone === "pill-danger"
            ? "buttonPill buttonPillDanger"
            : undefined;

  return (
    <button className={cx("button", toneClass, className)} {...props}>
      {leadingIcon}
      {children}
    </button>
  );
}
