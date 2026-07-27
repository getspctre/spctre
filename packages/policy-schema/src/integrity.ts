import type { OperationsLogEntry, OperationsLogEventType } from "./types";
import { jsBuildOperationsContentHash, jsValidateOperationsLogChain } from "./native";

export interface OperationsLogHashInput {
  eventType: OperationsLogEventType | string;
  sourceId?: string | null;
  sourceTable?: string | null;
  actorId: string;
  payload: Record<string, unknown>;
  prevHash?: string | null;
}

export interface OperationsLogChainEntry extends OperationsLogHashInput {
  id: string;
  contentHash: string;
  createdAt: string;
}

export interface OperationsLogChainIssue {
  entryId: string;
  createdAt: string;
  kind: "CONTENT_HASH_MISMATCH" | "PREV_HASH_MISMATCH";
  expected: string | null;
  actual: string | null;
}

export interface OperationsLogChainValidation {
  verified: boolean;
  issues: OperationsLogChainIssue[];
}

export function buildOperationsContentHash(input: OperationsLogHashInput): string {
  return jsBuildOperationsContentHash(JSON.stringify({
    eventType: input.eventType,
    sourceId: input.sourceId ?? null,
    sourceTable: input.sourceTable ?? null,
    actorId: input.actorId,
    payload: input.payload,
    prevHash: input.prevHash ?? null,
  }));
}

export function validateOperationsLogChain(entries: OperationsLogChainEntry[]): OperationsLogChainValidation {
  const issues = JSON.parse(jsValidateOperationsLogChain(JSON.stringify(entries.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    sourceId: e.sourceId ?? null,
    sourceTable: e.sourceTable ?? null,
    actorId: e.actorId,
    payload: e.payload,
    prevHash: e.prevHash ?? null,
    contentHash: e.contentHash,
    createdAt: e.createdAt,
  }))))) as OperationsLogChainIssue[];
  return { verified: issues.length === 0, issues };
}

export function operationsEntryToHashInput(entry: OperationsLogEntry): OperationsLogChainEntry {
  return {
    id: entry.id,
    eventType: entry.eventType,
    sourceId: entry.sourceId ?? null,
    sourceTable: entry.sourceTable ?? null,
    actorId: entry.actorId,
    payload: entry.payload,
    contentHash: entry.contentHash,
    prevHash: entry.prevHash ?? null,
    createdAt: entry.createdAt,
  };
}
