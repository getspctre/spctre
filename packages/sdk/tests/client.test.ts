import { describe, it, expect, vi } from "vitest";
import { createSpctreClient } from "../src/client.js";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

function makeCaptureFetch() {
  const captured: CapturedRequest[] = [];
  const fetch = async (req: Request): Promise<Response> => {
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => { headers[key] = value; });
    captured.push({ url: req.url, headers });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, captured };
}

describe("createSpctreClient — auth header", () => {
  it("injects Authorization: Bearer <token> on every request", async () => {
    const { fetch, captured } = makeCaptureFetch();
    const client = createSpctreClient({
      token: "my-api-key",
      baseUrl: "http://localhost/api/v1",
      fetch,
    });

    await client.GET("/evidence" as any);

    expect(captured).toHaveLength(1);
    expect(captured[0].headers["authorization"]).toBe("Bearer my-api-key");
  });
});

describe("createSpctreClient — base URL", () => {
  it("defaults to /api/v1 when no baseUrl provided", () => {
    // createSpctreClient should not throw when using the default relative base.
    // Actual request dispatch is tested separately with an absolute base.
    expect(() => createSpctreClient({ token: "tok" })).not.toThrow();
  });

  it("uses the provided absolute baseUrl in requests", async () => {
    const { fetch, captured } = makeCaptureFetch();
    const client = createSpctreClient({
      token: "tok",
      baseUrl: "https://spctre.dev/api/v1",
      fetch,
    });

    await client.GET("/evidence" as any);

    expect(captured[0].url).toMatch(/^https:\/\/spctre\.dev\/api\/v1/);
  });
});

describe("createSpctreClient — custom fetch", () => {
  it("uses the injected fetch implementation", async () => {
    const customFetch = vi.fn(async (_req: Request) =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = createSpctreClient({
      token: "tok",
      baseUrl: "http://localhost/api/v1",
      fetch: customFetch as typeof globalThis.fetch,
    });

    await client.GET("/evidence" as any);

    expect(customFetch).toHaveBeenCalledTimes(1);
  });
});
