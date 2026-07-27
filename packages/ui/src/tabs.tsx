import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cx } from "./utils";

interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function TabsRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("uiTabsRow", className)} role="tablist" {...props} />;
}

export function TabButton({ active = false, className, ...props }: TabButtonProps) {
  return <button className={cx("uiTab", active && "uiTabActive", className)} role="tab" {...props} />;
}
