/**
 * Standard API envelope conventions for all Spctre API surfaces.
 *
 * Every response from a Spctre API endpoint should carry:
 *  - `meta.traceId`   — correlation ID propagated from X-Request-ID or generated server-side
 *  - `meta.version`   — API version string ("2026-01")
 *  - `meta.ts`        — ISO timestamp of the response
 *
 * Success responses additionally carry:
 *  - `data`           — the typed payload
 *
 * Error responses additionally carry:
 *  - `error`          — human-readable message
 *  - `issues`         — optional array of field-level validation issues
 *
 * Paginated responses additionally carry:
 *  - `pagination`     — { total, limit, offset }
 */

export const API_VERSION = "2026-01";

export interface ApiMeta {
  traceId: string;
  version: string;
  ts: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  error: string;
  issues?: Array<{ path: string; message: string }>;
  meta: ApiMeta;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> extends ApiSuccess<T[]> {
  pagination: Pagination;
}

export function makeMeta(traceId: string): ApiMeta {
  return { traceId, version: API_VERSION, ts: new Date().toISOString() };
}

export function ok<T>(data: T, traceId: string): ApiSuccess<T> {
  return { data, meta: makeMeta(traceId) };
}

export function err(
  message: string,
  traceId: string,
  issues?: Array<{ path: string; message: string }>
): ApiError {
  return { error: message, issues, meta: makeMeta(traceId) };
}

export function paginated<T>(
  items: T[],
  pagination: Pagination,
  traceId: string
): PaginatedResponse<T> {
  return { data: items, pagination, meta: makeMeta(traceId) };
}
