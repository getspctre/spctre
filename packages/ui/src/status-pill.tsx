import type { HTMLAttributes } from "react";
import { cx } from "./utils";

export type StatusTone = "allow" | "warn" | "block" | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  allow: "pillAllow",
  warn: "pillWarn",
  block: "pillBlock",
  neutral: "pillNeutral"
};

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function StatusPill({ tone = "neutral", className, children, ...props }: StatusPillProps) {
  return (
    <span className={cx("pill", TONE_CLASS[tone], className)} {...props}>
      {children}
    </span>
  );
}

export function statusToneFromDecision(status: string): StatusTone {
  if (status === "ALLOW" || status === "APPROVED" || status === "PUBLISHED") return "allow";
  if (status === "WARN" || status === "PENDING" || status === "IN_REVIEW") return "warn";
  if (status === "DENY" || status === "CHANGES_REQUESTED" || status === "REMOVED") return "block";
  return "neutral";
}
