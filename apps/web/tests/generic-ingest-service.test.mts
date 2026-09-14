import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenericIntegration } from "../lib/repositories/evidence";

// Generic evidence ingest, which takes a batch of provider records and either
// delegates the whole batch to the worker or persists it here.
//
// Three properties decide whether evidence is trustworthy, and none of them
// were covered. A record the mapping rejects must still arrive, carrying its
// reason, rather than disappearing. One record failing to persist must not take
// the rest of the batch with it. And a worker response that does not line up
// with the batch it answered must be refused outright — silently zipping a
// short response against the payloads would attribute one record's outcome to
// another.

const getGenericEvidenceIntegrationSpy = vi.fn();
const persistGenericEvidenceSpy = vi.fn();
const normalizeGenericEvidenceSpy = vi.fn();
const fetchWithRetrySpy = vi.fn();
const evidenceIngestUrlSpy = vi.fn();
const workerInternalSecretSpy = vi.fn();
const reportSwallowedErrorSpy = vi.fn();

vi.mock("@/lib/repositories/evidence", () => ({
  getGenericEvidenceIntegration: getGenericEvidenceIntegrationSpy,
  isGenericEvidenceDatabaseConfigured: () => true,
  persistGenericEvidence: persistGenericEvidenceSpy,
}));
vi.mock("@/lib/domains/evidence/generic-mapping", () => ({
  normalizeGenericEvidence: normalizeGenericEvidenceSpy,
  sourceContentHash: () => "content-hash",
  sourceIdempotencyKey: (sourceEventId?: string) => `idem-${sourceEventId ?? "none"}`,
}));
vi.mock("@/lib/platform/fetch-retry", () => ({ fetchWithRetry: fetchWithRetrySpy }));
vi.mock("@/lib/platform/config", () => ({
  evidenceIngestUrl: evidenceIngestUrlSpy,
  workerInternalSecret: workerInternalSecretSpy,
}));
vi.mock("@/lib/platform/swallow", () => ({ reportSwallowedError: reportSwallowedErrorSpy }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));

const { ingestGenericEvidence, ingestGenericEvidenceBatch } =
  await import("../lib/domains/evidence/generic-ingest-service");

const INTEGRATION: GenericIntegration = {
  id: "integration-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  providerType: "generic_json",
  mappingRevisionId: "mapping-rev-1",
  mappingVersion: 3,
  fieldMapping: {},
};

function params(payloads: Record<string, unknown>[]) {
  return {
    tenantId: "tenant-1",
    serviceTokenId: "token-1",
    integrationId: "integration-1",
    providerType: "generic_json" as const,
    payloads,
    actorId: "actor-1",
  };
}

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId: "evt-1",
    occurredAt: "2026-09-14T00:00:00.000Z",
    action: "refund.create",
    enforcementDecision: "ALLOW",
    agentExternalId: "agent-external-1",
    sourceAttributes: {},
    ...overrides,
  };
}

/** Neither worker URL nor secret configured: everything persists locally. */
function localOnly() {
  evidenceIngestUrlSpy.mockReturnValue("");
  workerInternalSecretSpy.mockReturnValue("");
}

/** Worker delegation configured. */
function delegating() {
  evidenceIngestUrlSpy.mockReturnValue("http://worker.internal");
  workerInternalSecretSpy.mockReturnValue("shared-secret");
}

function workerResponds(body: unknown, ok = true, status = 200) {
  fetchWithRetrySpy.mockResolvedValue({ ok, status, json: async () => body });
}

beforeEach(() => {
  vi.clearAllMocks();
  getGenericEvidenceIntegrationSpy.mockResolvedValue(INTEGRATION);
  normalizeGenericEvidenceSpy.mockReturnValue(canonical());
  persistGenericEvidenceSpy.mockResolvedValue({ outcome: "accepted" });
  localOnly();
});

describe("an unknown integration", () => {
  it("answers not_found for every record without persisting any", async () => {
    getGenericEvidenceIntegrationSpy.mockResolvedValue(null);

    const results = await ingestGenericEvidenceBatch(params([{ a: 1 }, { b: 2 }]));

    expect(results).toEqual([{ outcome: "not_found" }, { outcome: "not_found" }]);
    expect(persistGenericEvidenceSpy).not.toHaveBeenCalled();
    expect(fetchWithRetrySpy).not.toHaveBeenCalled();
  });
});

describe("mapping failures travel with the record", () => {
  it("keeps the record and carries the mapper's reason", async () => {
    // A rejected record is evidence that something arrived and did not map. It
    // must reach the store, not vanish into a log line.
    normalizeGenericEvidenceSpy.mockImplementation(() => {
      throw new Error("occurredAt is not a timestamp");
    });

    await ingestGenericEvidenceBatch(params([{ bad: true }]));

    expect(persistGenericEvidenceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: null,
        rejectedReason: "occurredAt is not a timestamp",
        payload: { bad: true },
      }),
    );
    expect(reportSwallowedErrorSpy).toHaveBeenCalledWith(
      "ingestGenericEvidence.mapping",
      expect.anything(),
      { integrationId: "integration-1" },
    );
  });

  it("falls back to a generic reason when the mapper throws a non-error", async () => {
    normalizeGenericEvidenceSpy.mockImplementation(() => {
      throw "just a string";
    });

    await ingestGenericEvidenceBatch(params([{ bad: true }]));

    expect(persistGenericEvidenceSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rejectedReason: "The active mapping rejected this record." }),
    );
  });

  it("maps each record independently", async () => {
    normalizeGenericEvidenceSpy
      .mockReturnValueOnce(canonical({ sourceEventId: "evt-good" }))
      .mockImplementationOnce(() => {
        throw new Error("bad record");
      });

    await ingestGenericEvidenceBatch(params([{ ok: 1 }, { bad: 2 }]));

    expect(persistGenericEvidenceSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ rejectedReason: null }),
    );
    expect(persistGenericEvidenceSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ rejectedReason: "bad record" }),
    );
  });
});

describe("one record failing does not take the batch with it", () => {
  it("rejects the failed record and persists the rest", async () => {
    persistGenericEvidenceSpy
      .mockResolvedValueOnce({ outcome: "accepted", sourceRecordId: "s-1" })
      .mockRejectedValueOnce(new Error("constraint violation"))
      .mockResolvedValueOnce({ outcome: "accepted", sourceRecordId: "s-3" });

    const results = await ingestGenericEvidenceBatch(params([{ a: 1 }, { b: 2 }, { c: 3 }]));

    expect(results).toEqual([
      { outcome: "accepted", sourceRecordId: "s-1" },
      { outcome: "rejected", reason: "Unable to persist this record." },
      { outcome: "accepted", sourceRecordId: "s-3" },
    ]);
    expect(reportSwallowedErrorSpy).toHaveBeenCalledWith(
      "ingestGenericEvidenceBatch.persist",
      expect.anything(),
      { integrationId: "integration-1" },
    );
  });

  it("returns one result per payload, in order", async () => {
    const results = await ingestGenericEvidenceBatch(params([{ a: 1 }, { b: 2 }, { c: 3 }]));

    expect(results).toHaveLength(3);
  });
});

describe("delegation to the worker", () => {
  it("stays local unless both the URL and the secret are configured", async () => {
    evidenceIngestUrlSpy.mockReturnValue("http://worker.internal");
    workerInternalSecretSpy.mockReturnValue("");

    await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    expect(fetchWithRetrySpy).not.toHaveBeenCalled();
    expect(persistGenericEvidenceSpy).toHaveBeenCalled();
  });

  it("posts the batch with the internal secret and persists nothing locally", async () => {
    delegating();
    workerResponds({
      results: [{ outcome: "accepted", sourceRecordId: "s-1", canonicalEventId: "c-1" }],
    });

    const results = await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    const [target, init] = fetchWithRetrySpy.mock.calls[0];
    expect(String(target)).toBe("http://worker.internal/internal/generic-evidence");
    expect(init.headers["x-spctre-internal-secret"]).toBe("shared-secret");
    expect(persistGenericEvidenceSpy).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({ outcome: "accepted", canonicalEventId: "c-1" }),
    ]);
  });

  it("joins the worker path correctly when the base URL has a trailing slash", async () => {
    delegating();
    evidenceIngestUrlSpy.mockReturnValue("http://worker.internal/");
    workerResponds({ results: [{ outcome: "duplicate" }] });

    await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    expect(String(fetchWithRetrySpy.mock.calls[0][0])).toBe(
      "http://worker.internal/internal/generic-evidence",
    );
  });

  it("carries the mapping revision and the integration's workspace in each command", async () => {
    delegating();
    workerResponds({ results: [{ outcome: "duplicate" }] });

    await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    const [command] = JSON.parse(fetchWithRetrySpy.mock.calls[0][1].body).commands;
    expect(command).toMatchObject({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      mappingRevisionId: "mapping-rev-1",
      serviceTokenId: "token-1",
      contentHash: "content-hash",
      idempotencyKey: "idem-evt-1",
    });
  });

  it("marks a record with no agent reference as unresolved and uncorrelated", async () => {
    // Correlation confidence is what downstream assurance reads to decide
    // whether an event can be attributed to a governed agent.
    delegating();
    normalizeGenericEvidenceSpy.mockReturnValue(canonical({ agentExternalId: null }));
    workerResponds({ results: [{ outcome: "duplicate" }] });

    await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    const [command] = JSON.parse(fetchWithRetrySpy.mock.calls[0][1].body).commands;
    expect(command.canonical).toMatchObject({ correlationConfidence: 0, unresolved: true });
  });

  it("marks a record with an agent reference as correlatable", async () => {
    delegating();
    workerResponds({ results: [{ outcome: "duplicate" }] });

    await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    const [command] = JSON.parse(fetchWithRetrySpy.mock.calls[0][1].body).commands;
    expect(command.canonical).toMatchObject({ correlationConfidence: 0.5, unresolved: false });
  });

  it("sends a null canonical for a record the mapping rejected", async () => {
    delegating();
    normalizeGenericEvidenceSpy.mockImplementation(() => {
      throw new Error("unmappable");
    });
    workerResponds({ results: [{ outcome: "rejected", reason: "unmappable" }] });

    await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    const [command] = JSON.parse(fetchWithRetrySpy.mock.calls[0][1].body).commands;
    expect(command.canonical).toBeNull();
    expect(command.rejectedReason).toBe("unmappable");
  });
});

describe("a worker response that does not line up is refused", () => {
  beforeEach(() => delegating());

  it("throws on a non-2xx status", async () => {
    workerResponds({}, false, 503);

    await expect(ingestGenericEvidenceBatch(params([{ a: 1 }]))).rejects.toThrow(
      "Worker generic evidence ingest failed with status 503.",
    );
  });

  it("throws when the worker returns fewer results than the batch", async () => {
    // The results are zipped against the payloads by index. A short response
    // would attribute one record's outcome to another.
    workerResponds({ results: [{ outcome: "duplicate" }] });

    await expect(ingestGenericEvidenceBatch(params([{ a: 1 }, { b: 2 }]))).rejects.toThrow(
      "Worker generic evidence ingest returned an invalid response.",
    );
  });

  it("throws when the worker returns no results at all", async () => {
    workerResponds({});

    await expect(ingestGenericEvidenceBatch(params([{ a: 1 }]))).rejects.toThrow(
      "Worker generic evidence ingest returned an invalid response.",
    );
  });

  it("throws when an accepted result omits its identifiers", async () => {
    workerResponds({ results: [{ outcome: "accepted", sourceRecordId: "s-1" }] });

    await expect(ingestGenericEvidenceBatch(params([{ a: 1 }]))).rejects.toThrow(
      "Worker generic evidence ingest returned an invalid response.",
    );
  });

  it("throws when a rejected result omits its reason", async () => {
    workerResponds({ results: [{ outcome: "rejected" }] });

    await expect(ingestGenericEvidenceBatch(params([{ a: 1 }]))).rejects.toThrow(
      "Worker generic evidence ingest returned an invalid response.",
    );
  });

  it("passes a rejected result's source record id through when it has one", async () => {
    workerResponds({
      results: [{ outcome: "rejected", reason: "mapping rejected", sourceRecordId: "s-9" }],
    });

    const results = await ingestGenericEvidenceBatch(params([{ a: 1 }]));

    expect(results).toEqual([
      { outcome: "rejected", reason: "mapping rejected", sourceRecordId: "s-9" },
    ]);
  });
});

describe("the single-record entry point", () => {
  it("returns the one result the batch produced", async () => {
    persistGenericEvidenceSpy.mockResolvedValue({ outcome: "accepted", sourceRecordId: "s-1" });

    const result = await ingestGenericEvidence({
      tenantId: "tenant-1",
      serviceTokenId: "token-1",
      integrationId: "integration-1",
      providerType: "generic_json",
      payload: { a: 1 },
      actorId: "actor-1",
    });

    expect(result).toEqual({ outcome: "accepted", sourceRecordId: "s-1" });
    expect(persistGenericEvidenceSpy).toHaveBeenCalledTimes(1);
  });
});
