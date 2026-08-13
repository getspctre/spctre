import { randomUUID } from "node:crypto";
import { signPayloadReceipt, verifyPayloadReceipt, type SignedPayloadReceipt } from "./receipts";

export interface PublicationAttestationPayload {
  schema: "spctre.publication-attestation.v1";
  attestationId: string;
  [key: string]: unknown;
}

export type SignedPublicationAttestation = SignedPayloadReceipt<PublicationAttestationPayload>;

export interface PublicationSigningChallengePayload {
  schema: "spctre.publication-signing-challenge.v1";
  challengeId: string;
  challenge: string;
}

export type SignedPublicationSigningChallenge =
  SignedPayloadReceipt<PublicationSigningChallengePayload>;

export function signPublicationAttestation(params: {
  payload: Omit<PublicationAttestationPayload, "schema" | "attestationId"> & {
    attestationId?: string;
  };
  privateKey: string;
  keyId: string;
}): SignedPublicationAttestation {
  return signPayloadReceipt({
    privateKey: params.privateKey,
    keyId: params.keyId,
    payload: {
      schema: "spctre.publication-attestation.v1",
      attestationId: params.payload.attestationId ?? randomUUID(),
      ...params.payload,
    },
  });
}

export function verifyPublicationAttestation(receipt: SignedPublicationAttestation): {
  verified: boolean;
  reason?: string;
} {
  if (receipt.payload.schema !== "spctre.publication-attestation.v1")
    return { verified: false, reason: "Unsupported publication-attestation schema." };
  return verifyPayloadReceipt(receipt);
}

/** Verifies proof of possession before a signing key is enrolled or rotated. */
export function verifyPublicationSigningChallenge(receipt: SignedPublicationSigningChallenge): {
  verified: boolean;
  reason?: string;
} {
  if (receipt.payload.schema !== "spctre.publication-signing-challenge.v1")
    return { verified: false, reason: "Unsupported publication-signing challenge schema." };
  return verifyPayloadReceipt(receipt);
}
