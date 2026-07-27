export function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v === Math.floor(v)) return v;
  return undefined;
}
