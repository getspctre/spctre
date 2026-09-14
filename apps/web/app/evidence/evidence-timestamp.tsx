"use client";

import { useLocale } from "next-intl";

/** UTC keeps incident timestamps comparable and avoids server/client timezone drift. */
export function EvidenceTimestamp({ value }: { value: string }) {
  const locale = useLocale();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>Time unavailable</span>;
  const label = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
    hourCycle: "h23",
  }).format(date);
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {label}
    </time>
  );
}
