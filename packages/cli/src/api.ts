import * as fs from "node:fs";
import { readConfig } from "./config";
import { getOutputFormat, printJson } from "./output";

export type ApiMethod = "GET" | "POST" | "DELETE";

export interface ApiRequestOptions {
  method: ApiMethod | string;
  path: string;
  key?: string;
  url?: string;
  data?: string;
  file?: string;
  headers?: string[];
  query?: string[];
  outputFile?: string;
  yes?: boolean;
  output?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function apiPath(path: string, query: string[] | undefined): string {
  const candidate = path.trim();
  if (!candidate.startsWith("/") || candidate.includes("..") || candidate.startsWith("//")) {
    fail("Error: path must be a relative public API path such as /evaluate.");
  }
  if (candidate === "/api" || candidate.startsWith("/api/")) {
    fail("Error: omit /api/v1; the CLI always targets the public v1 API.");
  }
  if (!query?.length) return candidate;
  const separator = candidate.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  for (const entry of query) {
    const equals = entry.indexOf("=");
    if (equals <= 0) fail(`Error: invalid query ${JSON.stringify(entry)}; use key=value.`);
    params.append(entry.slice(0, equals), entry.slice(equals + 1));
  }
  return `${candidate}${separator}${params}`;
}

function requestHeaders(headers: string[] | undefined, key: string): Headers {
  const parsed = new Headers({ Authorization: `Bearer ${key}`, Accept: "application/json" });
  for (const header of headers ?? []) {
    const separator = header.indexOf(":");
    if (separator <= 0) fail(`Error: invalid header ${JSON.stringify(header)}; use Name: value.`);
    parsed.set(header.slice(0, separator).trim(), header.slice(separator + 1).trim());
  }
  return parsed;
}

function requestBody(options: ApiRequestOptions, headers: Headers): string | undefined {
  if (options.data && options.file) fail("Error: use either --data or --file, not both.");
  if (options.file) {
    try {
      const body = fs.readFileSync(options.file, "utf8");
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return body;
    } catch {
      fail(`Error: request body file not found: ${options.file}`);
    }
  }
  if (options.data !== undefined) {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return options.data;
  }
  return undefined;
}

function requestMethod(options: ApiRequestOptions): ApiMethod {
  const method = options.method.toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    fail("Error: method must be GET, POST, or DELETE.");
  }
  if (method === "DELETE" && !options.yes) {
    fail("Error: DELETE requests require --yes to confirm this irreversible operation.");
  }
  return method;
}

function requestCredentials(options: ApiRequestOptions): { baseUrl: string; key: string } {
  const config = readConfig();
  const key = options.key ?? config?.token;
  if (!key) fail("Error: an API key is required. Pass --key or run spctre init first.");
  return {
    baseUrl: (options.url ?? config?.controlPlaneUrl ?? "http://localhost:3000").replace(
      /\/+$/,
      "",
    ),
    key,
  };
}

function assertRequestBody(method: ApiMethod, body: string | undefined): void {
  if ((method === "GET" || method === "DELETE") && body !== undefined) {
    fail(`Error: ${method} requests cannot include --data or --file.`);
  }
}

function reportApiError(
  status: number,
  statusText: string,
  body: string | Buffer,
  output?: string,
): never {
  const message =
    (typeof body === "string" ? body : body.toString("utf8")) || statusText || `HTTP ${status}`;
  if (getOutputFormat(output) === "json") {
    printJson({ ok: false, status, error: message });
    process.exit(1);
  }
  fail(`Request failed (${status}): ${message}`);
}

function reportApiSuccess(
  status: number,
  statusText: string,
  body: string | Buffer,
  options: ApiRequestOptions,
): void {
  if (options.outputFile) {
    fs.writeFileSync(options.outputFile, body);
    if (getOutputFormat(options.output) === "json") {
      printJson({ ok: true, status, outputFile: options.outputFile });
    } else {
      console.log(`Response written to ${options.outputFile}`);
    }
    return;
  }

  const text = body as string;
  if (getOutputFormat(options.output) === "json") {
    try {
      printJson(JSON.parse(text));
    } catch {
      printJson({ ok: true, status, body: text });
    }
    return;
  }
  process.stdout.write(text ? `${text}\n` : `${status} ${statusText}\n`);
}

/**
 * Calls one documented public REST v1 operation. This is intentionally a
 * constrained escape hatch: it accepts only a relative path and always adds
 * /api/v1, preventing credentials from being sent to an arbitrary origin.
 */
export async function apiRequest(options: ApiRequestOptions): Promise<void> {
  const method = requestMethod(options);
  const { baseUrl, key } = requestCredentials(options);
  const headers = requestHeaders(options.headers, key);
  const body = requestBody(options, headers);
  assertRequestBody(method, body);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1${apiPath(options.path, options.query)}`, {
      method,
      headers,
      body,
    });
  } catch (error) {
    fail(`Request failed: ${String(error)}`);
  }

  const responseBody = options.outputFile
    ? Buffer.from(await response.arrayBuffer())
    : await response.text();
  if (!response.ok)
    reportApiError(response.status, response.statusText, responseBody, options.output);
  reportApiSuccess(response.status, response.statusText, responseBody, options);
}
