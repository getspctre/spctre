import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";

export type ActionReceiptOutcome = "PROCEED" | "ESCALATE" | "ABORT";

export interface ActionReceiptPayload {
  schema: "spctre.action-receipt.v1";
  receiptId: string;
  decisionId: string;
  branchId?: string;
  revisionId?: string;
  artifactHash: string;
  runtimeTarget: string;
  action: { agentId?: string; connector?: string; name?: string };
  outcome: ActionReceiptOutcome;
  actorId: string;
  reviewerId?: string;
  issuedAt: string;
}

export interface SignedActionReceipt {
  payload: ActionReceiptPayload;
  signature: {
    algorithm: "Ed25519";
    keyId: string;
    publicKey: string;
    payloadHash: string;
    value: string;
  };
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalizeActionReceiptPayload(payload: ActionReceiptPayload): string {
  return stableJsonStringify(payload as unknown as JsonValue);
}

export function signActionReceipt(params: {
  payload: Omit<ActionReceiptPayload, "schema" | "receiptId"> & { receiptId?: string };
  privateKey: string;
  keyId: string;
}): SignedActionReceipt {
  const payload: ActionReceiptPayload = {
    schema: "spctre.action-receipt.v1",
    receiptId: params.payload.receiptId ?? randomUUID(),
    ...params.payload,
  };
  const canonical = canonicalizeActionReceiptPayload(payload);
  const privateKey = createPrivateKey(params.privateKey);
  const publicKey = createPublicKey(privateKey.export({ type: "pkcs8", format: "pem" }));
  return {
    payload,
    signature: {
      algorithm: "Ed25519",
      keyId: params.keyId,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      payloadHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
      value: sign(null, Buffer.from(canonical), privateKey).toString("base64"),
    },
  };
}

export function verifyActionReceipt(receipt: SignedActionReceipt): { verified: boolean; reason?: string } {
  if (receipt.payload.schema !== "spctre.action-receipt.v1") return { verified: false, reason: "Unsupported receipt schema." };
  if (receipt.signature.algorithm !== "Ed25519") return { verified: false, reason: "Unsupported signature algorithm." };
  try {
    const canonical = canonicalizeActionReceiptPayload(receipt.payload);
    const payloadHash = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    if (payloadHash !== receipt.signature.payloadHash) return { verified: false, reason: "Payload hash mismatch." };
    const publicKey = createPublicKey({ key: Buffer.from(receipt.signature.publicKey, "base64"), type: "spki", format: "der" });
    return verify(null, Buffer.from(canonical), publicKey, Buffer.from(receipt.signature.value, "base64"))
      ? { verified: true }
      : { verified: false, reason: "Signature verification failed." };
  } catch {
    return { verified: false, reason: "Invalid receipt encoding." };
  }
}

function stableJsonStringify(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize non-finite JSON number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(",")}}`;
}
