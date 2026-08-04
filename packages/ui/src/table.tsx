import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";
import { cx } from "./utils";

export function TableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("uiTableShell", className)} {...props} />;
}

export function DataTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx("uiTable", className)} {...props} />;
}

export function TableHeaderCell({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cx("uiTableHead", className)} {...props}>
      {children}
    </th>
  );
}

export function TableCell({ className, children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cx("uiTableCell", className)} {...props}>
      {children as ReactNode}
    </td>
  );
}
