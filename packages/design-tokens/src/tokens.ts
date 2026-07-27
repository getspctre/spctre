export const colors = {
  bg: "oklch(0.973 0.006 236)",
  panel: "oklch(0.996 0.004 236)",
  ink: "oklch(0.23 0.037 257)",
  muted: "oklch(0.515 0.035 256)",
  line: "oklch(0.88 0.014 250)",
  accent: "oklch(0.48 0.095 184)",
  accentSoft: "oklch(0.94 0.039 184)",
  warn: "oklch(0.48 0.095 68)",
  warnSoft: "oklch(0.955 0.046 82)",
  block: "oklch(0.49 0.15 29)",
  blockSoft: "oklch(0.94 0.045 29)",
  allow: "oklch(0.48 0.105 151)",
  allowSoft: "oklch(0.94 0.046 151)"
} as const;

export const typography = {
  fontSans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: "ui-monospace, monospace",
  pageTitle: "24px",
  heading: "17px",
  rowTitle: "14px",
  metadata: "11px"
} as const;

export const spacing = {
  xxs: "4px",
  xs: "8px",
  sm: "12px",
  md: "16px",
  lg: "24px"
} as const;

export const radius = {
  sm: "7px",
  md: "8px",
  full: "999px"
} as const;

export const motion = {
  fast: "120ms",
  normal: "190ms",
  easing: "cubic-bezier(0.16, 1, 0.3, 1)"
} as const;

export const elevation = {
  panel: "0 18px 44px oklch(0.2 0.02 250 / 0.18)"
} as const;

export const statusSemantics = {
  allow: { foreground: colors.allow, background: colors.allowSoft },
  warn: { foreground: colors.warn, background: colors.warnSoft },
  block: { foreground: colors.block, background: colors.blockSoft },
  neutral: { foreground: colors.muted, background: "oklch(0.93 0.01 250)" }
} as const;
