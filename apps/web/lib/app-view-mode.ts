export const APP_VIEW_MODE_COOKIE = "spctre_view_mode";

export type AppViewMode = "executive" | "forensic";

export function normalizeAppViewMode(value?: string | null): AppViewMode {
  return value === "forensic" ? "forensic" : "executive";
}

export function isForensicViewMode(mode: AppViewMode): boolean {
  return mode === "forensic";
}

export function formatProvenanceId(
  value: string | null | undefined,
  mode: AppViewMode,
  length = 12,
  executiveFormatter?: (value: string) => string,
): string {
  if (!value) return "pending";
  if (isForensicViewMode(mode) || value.length <= length) return value;
  if (executiveFormatter) return executiveFormatter(value);
  return value;
}

export function formatArtifactHash(
  value: string | null | undefined,
  mode: AppViewMode,
  executiveFormatter?: (hash: string) => string,
): string {
  if (!value) return "pending";
  if (isForensicViewMode(mode)) return value;
  return executiveFormatter ? executiveFormatter(value) : formatProvenanceId(value, mode, 18);
}
