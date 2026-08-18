import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { apiRequest } from "../src/api";

function response(body: string, status = 200) {
  return { ok: status < 400, status, statusText: "OK", text: async () => body };
}

describe("spctre api request", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("targets the public v1 API and authenticates the request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response('{"outcome":"ALLOW"}'));
    vi.stubGlobal("fetch", fetchSpy);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await apiRequest({
      method: "POST",
      path: "/evaluate",
      key: "spctre_svc_test",
      url: "https://control.test/",
      data: '{"connector":"stripe"}',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://control.test/api/v1/evaluate",
      expect.objectContaining({ method: "POST", body: '{"connector":"stripe"}' }),
    );
    const headers = fetchSpy.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer spctre_svc_test");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(stdout).toHaveBeenCalledWith('{"outcome":"ALLOW"}\n');
  });

  it("rejects legacy or absolute API paths before issuing a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      apiRequest({
        method: "GET",
        path: "/api/evaluate",
        key: "test",
        url: "https://control.test",
      }),
    ).rejects.toThrow("exit:1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("encodes repeated query parameters on a versioned request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await apiRequest({
      method: "GET",
      path: "/trust/history",
      query: ["agentId=agent/a", "limit=50"],
      key: "test",
      url: "https://control.test",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://control.test/api/v1/trust/history?agentId=agent%2Fa&limit=50",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requires explicit confirmation before a DELETE request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      apiRequest({
        method: "DELETE",
        path: "/evidence/publication-signing-keys/key-1",
        key: "test",
        url: "https://control.test",
      }),
    ).rejects.toThrow("exit:1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("writes an artifact response unchanged when --output-file is used", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => bytes.buffer,
      });
    vi.stubGlobal("fetch", fetchSpy);
    const outputFile = path.join(os.tmpdir(), `spctre-api-${Date.now()}.bin`);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await apiRequest({
      method: "GET",
      path: "/evidence/publication-artifacts/sha256:test",
      key: "test",
      url: "https://control.test",
      outputFile,
    });

    expect(fs.readFileSync(outputFile)).toEqual(Buffer.from(bytes));
    fs.rmSync(outputFile, { force: true });
  });
});
