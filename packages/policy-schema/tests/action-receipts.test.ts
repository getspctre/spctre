import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signActionReceipt, verifyActionReceipt } from "../src/receipts";

describe("action receipts", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const receipt = () =>
    signActionReceipt({
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      keyId: "test-ed25519-2026",
      payload: {
        receiptId: "5aaf2b04-e025-49f3-9a73-6f925d8a15cd",
        decisionId: "decision-001",
        branchId: "branch-001",
        revisionId: "revision-001",
        artifactHash: "sha256:artifact",
        runtimeTarget: "stripe.refund.create",
        action: { agentId: "billing-agent", connector: "stripe", name: "refund.create" },
        outcome: "ABORT",
        actorId: "gateway-service",
        reviewerId: "reviewer-001",
        issuedAt: "2026-07-16T00:00:00.000Z",
      },
    });

  it("verifies a portable Ed25519 receipt", () => {
    expect(verifyActionReceipt(receipt())).toEqual({ verified: true });
  });

  it("rejects a receipt whose policy lineage was changed", () => {
    const signed = receipt();
    signed.payload.revisionId = "revision-tampered";
    expect(verifyActionReceipt(signed)).toEqual({
      verified: false,
      reason: "Payload hash mismatch.",
    });
  });
});
