import createClient from "openapi-fetch";
import type { paths } from "./schema.js";

export interface SpctreClientOptions {
  /** Base URL of the Spctre instance. Defaults to the current origin's /api/v1. */
  baseUrl?: string;
  /** Service account API key. */
  token: string;
  /** Optional custom fetch implementation. */
  fetch?: typeof globalThis.fetch;
}

export function createSpctreClient({
  baseUrl = "/api/v1",
  token,
  fetch: customFetch,
}: SpctreClientOptions) {
  return createClient<paths>({
    baseUrl,
    fetch: customFetch,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

export type SpctreClient = ReturnType<typeof createSpctreClient>;
