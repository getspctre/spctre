import { describe, expect, it } from "vitest";
import { MAX_REQUEST_BYTES, readBoundedText } from "../app/api/ingest/_shared";

describe("generic evidence request limits", () => {
  it("rejects a streamed body that exceeds the limit without Content-Length", async () => {
    const request = new Request("https://example.test/ingest", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1));
          controller.close();
        },
      }),
      duplex: "half",
    });
    const result = await readBoundedText(request);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });
});
