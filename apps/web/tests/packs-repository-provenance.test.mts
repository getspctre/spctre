import { describe, expect, it, vi } from "vitest";

// Hoisted fake `sql` tagged-template client that captures the source_document
// JSON passed to the policy_revision INSERT, so we can assert the pack's
// parameter catalog actually survives into what's persisted — not just what
// the domain service *intends* to pass.
const { state, sqlMock } = vi.hoisted(() => {
  const state = { capturedSourceDocument: null as Record<string, unknown> | null };

  const fn = (...args: unknown[]): Promise<unknown[]> => {
    const strings = args[0] as TemplateStringsArray;
    const joined = Array.isArray(strings)
      ? Array.from(strings).join(" ").replace(/\s+/g, " ").trim().toUpperCase()
      : "";

    if (joined.includes("SELECT ID FROM WORKSPACE")) {
      return Promise.resolve([{ id: "workspace-1" }]);
    }
    if (joined.includes("INSERT INTO POLICY_REVISION")) {
      // Positional args: [strings, revisionId, tenantId, workspaceId, branchId,
      // sourcePath, sourceDocumentJson, sourceHash, authorId, message]
      state.capturedSourceDocument = JSON.parse(args[6] as string);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };

  const sqlMock = Object.assign(fn, {
    begin: vi.fn(async (callback: (tx: typeof fn) => Promise<unknown>) => callback(fn)),
    // Mirrors postgres' sql.json(): the persisted jsonb payload is the
    // serialized value, so captured args stay JSON-parseable strings.
    json: (value: unknown) => JSON.stringify(value),
  });

  return { state, sqlMock };
});

vi.mock("@/lib/db", () => ({ sql: sqlMock, rawSql: sqlMock }));

vi.mock("@/lib/repositories/seed/local-dev", () => ({ ensureDemoTenant: vi.fn(async () => {}) }));

const { persistPackInstallBranch } = await import("../lib/repositories/packs");

describe("persistPackInstallBranch provenance metadata", () => {
  it("persists the pack's parameter catalog in the source_document metadata", async () => {
    const parameters = [
      {
        key: "stripe.refund_review_threshold_cents",
        label: "Refund amount requiring review (cents)",
        type: "number",
        default: 50000,
        description:
          "Refunds at or above this amount escalate for review instead of auto-allowing.",
      },
    ];

    await persistPackInstallBranch({
      tenantId: "tenant-1",
      authorId: "actor-1",
      branchName: "stripe",
      workspaceId: "workspace-1",
      connector: "stripe",
      sourcePath: "packs/stripe-v1.json",
      source: "{}",
      rules: [],
      metadata: {
        name: "Stripe Governance Pack",
        parameters,
        spctre_pack: { packId: "stripe-v1", connector: "stripe" },
      },
      message: "Install Stripe Governance Pack v1.0.0",
    });

    expect(state.capturedSourceDocument).not.toBeNull();
    const persistedMetadata = state.capturedSourceDocument!.metadata as Record<string, unknown>;
    expect(persistedMetadata.parameters).toEqual(parameters);
  });
});
