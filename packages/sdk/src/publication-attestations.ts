import type { SpctreClient } from "./client.js";
import type { components } from "./schema.js";

export type PublicationAttestationPayload =
  components["schemas"]["PublicationAttestationIngestRequest"]["attestation"];
export type SignedPublicationAttestation = NonNullable<
  components["schemas"]["PublicationAttestationIngestRequest"]["receipt"]
>;

/** SHA-256 address for the exact bytes retained with a publication attestation. */
export async function publicationContentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Retain exact bytes before submitting facts that reference their hash. */
export async function retainPublicationContentArtifact(
  client: SpctreClient,
  bytes: Uint8Array,
): Promise<{ contentHash: string }> {
  const contentHash = await publicationContentHash(bytes);
  const { error } = await client.POST("/evidence/publication-artifacts", {
    body: bytes as never,
    params: { header: { "X-Spctre-Content-Hash": contentHash } },
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (error) throw new Error("Publication artifact retention failed.");
  return { contentHash };
}

/**
 * Canonicalize and sign facts with the caller's key provider. This keeps the
 * SDK browser-safe while allowing Node callers to pass policy-schema's Ed25519
 * signer and WebCrypto callers to use a hardware-backed key.
 */
export async function signPublicationFacts(params: {
  payload: PublicationAttestationPayload;
  keyId: string;
  publicKey: string;
  sign: (canonicalPayload: string) => Promise<string>;
}): Promise<SignedPublicationAttestation> {
  const canonical = stableJsonStringify(params.payload);
  return {
    payload: params.payload,
    signature: {
      algorithm: "Ed25519",
      keyId: params.keyId,
      publicKey: params.publicKey,
      payloadHash: await publicationContentHash(new TextEncoder().encode(canonical)),
      value: await params.sign(canonical),
    },
  };
}

/** Submit immutable facts, optionally bound to a registered signing key. */
export async function submitPublicationAttestation(
  client: SpctreClient,
  input: {
    idempotencyKey: string;
    attestation: PublicationAttestationPayload;
    receipt?: SignedPublicationAttestation;
  },
) {
  const { data, error } = await client.POST("/evidence/publications", { body: input });
  if (error) throw new Error("Publication attestation submission failed.");
  return data;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize non-finite JSON number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Cannot canonicalize a non-JSON publication value.");
}
