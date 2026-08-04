import type { OperationsLogEventType } from "@spctre/policy-schema";
import {
  listOperationsLog,
  listOperationsLogKeyset,
  verifyOperationsLogChain,
} from "@/lib/repositories/operations-log";
import { listBundleExportLogs } from "@/lib/repositories/bundle-export-log";
import { runWithTenantContext } from "@/lib/tenant-context";
import { buildKeysetPage, decodeCursor, type KeysetPage } from "@/lib/pagination/keyset";

export type OperationsLogEntries = Awaited<ReturnType<typeof listOperationsLog>>;
export type OperationsLogEntry = OperationsLogEntries[number];
export type BundleExportLogEntries = Awaited<ReturnType<typeof listBundleExportLogs>>;

// Offset-paginated ledger read. Retained for the external /api/operations JSON
// route, whose documented contract exposes limit/offset. Internal UI reads
// should prefer listOperationsLedgerKeyset.
export async function listOperationsLedger(params: {
  tenantId: string;
  workspaceId: string | null;
  eventType?: OperationsLogEventType;
  limit: number;
  offset: number;
}): Promise<OperationsLogEntries> {
  return runWithTenantContext(params.tenantId, () =>
    listOperationsLog(params.tenantId, params.workspaceId ?? undefined, {
      eventType: params.eventType,
      limit: params.limit,
      offset: params.offset,
    }),
  );
}

// Keyset-paginated ledger read for the operations UI. `cursor` is the opaque
// URL param; a missing/invalid cursor yields the first (newest) page. See
// database-optimizations-audit finding 7.
export async function listOperationsLedgerKeyset(params: {
  tenantId: string;
  workspaceId: string | null;
  eventType?: OperationsLogEventType;
  limit: number;
  cursor?: string;
}): Promise<KeysetPage<OperationsLogEntry>> {
  const decoded = decodeCursor(params.cursor);
  const rows = await runWithTenantContext(params.tenantId, () =>
    listOperationsLogKeyset(params.tenantId, params.workspaceId ?? undefined, {
      eventType: params.eventType,
      limit: params.limit,
      cursor: decoded,
    }),
  );
  return buildKeysetPage(rows, params.limit, decoded, (entry) => ({
    ts: entry.createdAt,
    id: entry.id,
  }));
}

export async function verifyOperationsLedger(params: {
  tenantId: string;
  limit: number;
}): ReturnType<typeof verifyOperationsLogChain> {
  return verifyOperationsLogChain(params.tenantId, params.limit);
}

export async function listBundleExportHistory(params: {
  tenantId: string;
  workspaceId: string;
  limit: number;
  offset: number;
}): Promise<BundleExportLogEntries> {
  return runWithTenantContext(params.tenantId, () =>
    listBundleExportLogs({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      limit: params.limit,
      offset: params.offset,
    }),
  );
}
