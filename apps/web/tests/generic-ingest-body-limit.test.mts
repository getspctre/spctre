import { describe, expect, it } from "vitest";
import {
  handleGenericRecords,
  MAX_RECORDS_PER_REQUEST,
  MAX_REQUEST_BYTES,
  readBoundedText,
} from "../app/api/ingest/_shared";

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

  it("rejects batches that exceed the record limit before persistence", async () => {
    const response = await handleGenericRecords({
      request: new Request("https://example.test/ingest", { method: "POST" }),
      providerType: "generic_ndjson",
      records: Array.from({ length: MAX_RECORDS_PER_REQUEST + 1 }, () => ({})),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: `Request contains more than ${MAX_RECORDS_PER_REQUEST} evidence records.`,
    });
  });
});
