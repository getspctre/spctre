import * as fs from "node:fs";
import * as path from "node:path";

export interface ShadowEntry {
  decisionId: string;
  connector: string;
  action: string;
  outcome: string;
  matchedRules: string[];
  artifactHash: string;
  timestamp: string;
  reason?: string;
}

function sidecarDir(): string {
  return path.resolve(process.cwd(), ".spctre");
}

function shadowStatePath(): string {
  return path.join(sidecarDir(), "shadow-state.json");
}

function shadowLogPath(): string {
  return path.join(sidecarDir(), "shadow-log.jsonl");
}

export function isShadowModeActive(): boolean {
  try {
    const state = JSON.parse(fs.readFileSync(shadowStatePath(), "utf8")) as { active?: boolean };
    return state.active === true;
  } catch {
    return false;
  }
}

export function setShadowMode(active: boolean): void {
  const target = shadowStatePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (active) {
    fs.writeFileSync(target, JSON.stringify({ active: true, startedAt: new Date().toISOString() }));
  } else {
    try { fs.unlinkSync(target); } catch { /* already gone */ }
  }
}

export function appendShadowLog(entry: ShadowEntry): void {
  const target = shadowLogPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(entry)}\n`);
}

export function readShadowLog(): ShadowEntry[] {
  try {
    return fs.readFileSync(shadowLogPath(), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ShadowEntry);
  } catch {
    return [];
  }
}

// Incremental tail: read only the bytes appended since `offset` instead of
// re-reading and re-parsing the whole file every poll (which made CPU and
// allocations grow linearly with log size over a long watch session — see
// concurrency-and-memory-audit finding 9). Returns the parsed complete lines
// and the byte offset to resume from; any trailing partial line is left
// unconsumed. A smaller-than-offset file (rotation/truncation) restarts at 0.
export function readShadowLogFrom(offset: number): { entries: ShadowEntry[]; nextOffset: number } {
  try {
    const fd = fs.openSync(shadowLogPath(), "r");
    try {
      const size = fs.fstatSync(fd).size;
      let from = offset;
      if (size < from) from = 0; // rotated or truncated — start over
      if (size === from) return { entries: [], nextOffset: from };

      const length = size - from;
      const buf = Buffer.allocUnsafe(length);
      const bytesRead = fs.readSync(fd, buf, 0, length, from);
      const text = buf.toString("utf8", 0, bytesRead);

      const lastNewline = text.lastIndexOf("\n");
      if (lastNewline === -1) return { entries: [], nextOffset: from }; // no complete line yet

      const consumed = text.slice(0, lastNewline + 1);
      const entries: ShadowEntry[] = [];
      for (const line of consumed.split("\n")) {
        if (!line) continue;
        try {
          entries.push(JSON.parse(line) as ShadowEntry);
        } catch {
          // skip malformed line
        }
      }
      return { entries, nextOffset: from + Buffer.byteLength(consumed, "utf8") };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { entries: [], nextOffset: offset };
  }
}

export function formatShadowEntry(entry: ShadowEntry): string {
  const ruleSuffix = entry.matchedRules.length > 0
    ? ` (${entry.reason ?? entry.matchedRules.join(", ")})`
    : "";
  return `[shadow] ${entry.connector}.${entry.action} → ${entry.outcome}${ruleSuffix}`;
}

export function shadowLogSummary(entries: ShadowEntry[]): {
  total: number;
  allowed: number;
  denied: number;
  warned: number;
  topBlockedRules: string[];
} {
  const allowed = entries.filter((e) => e.outcome === "ALLOW").length;
  const denied = entries.filter((e) => e.outcome === "DENY").length;
  const warned = entries.filter((e) => e.outcome === "WARN").length;

  const ruleCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.outcome === "DENY" || entry.outcome === "WARN") {
      for (const r of entry.matchedRules) {
        ruleCounts.set(r, (ruleCounts.get(r) ?? 0) + 1);
      }
    }
  }
  const topBlockedRules = [...ruleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([rule, count]) => `${rule} (${count}x)`);

  return { total: entries.length, allowed, denied, warned, topBlockedRules };
}
