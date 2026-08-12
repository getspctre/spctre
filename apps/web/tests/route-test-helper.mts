export interface RouteRequestOptions {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  headers?: HeadersInit;
}

/** Builds a Next.js route request while keeping auth and body contracts explicit. */
export function createRouteRequest({
  path,
  method = "POST",
  token,
  body,
  headers,
}: RouteRequestOptions) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  if (body !== undefined && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  return new Request(new URL(path, "http://localhost:3000"), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
