"use client";

import { useActionState } from "react";
import {
  createSigningKeyChallenge,
  enrollSigningKey,
  revokeSigningKey,
  type SigningKeyActionState,
} from "./actions";
import { AdminMutationStatus } from "../mutation-status";

function Status({ state }: { state: SigningKeyActionState }) {
  return (
    <AdminMutationStatus
      error={state && !state.ok ? state.error : undefined}
      message={state?.ok ? state.message : undefined}
    />
  );
}

export function SigningKeyManager({
  keys,
}: {
  keys: Array<{
    id: string;
    entityRef: string;
    keyId: string;
    publicKey: string;
    ownershipVerifiedAt: string;
    revokedAt: string | null;
    replacesKeyId: string | null;
  }>;
}) {
  const [challengeState, challengeAction] = useActionState(createSigningKeyChallenge, null);
  const [enrollState, enrollAction] = useActionState(enrollSigningKey, null);
  const [revokeState, revokeAction] = useActionState(revokeSigningKey, null);
  return (
    <div className="adminAuthStack">
      <section className="adminAuthPanel">
        <p className="eyebrow">Trusted signer registry</p>
        <h2>Active and historical keys</h2>
        {keys.length ? (
          <div className="auditTableWrapper">
            <table className="auditTable">
              <thead>
                <tr>
                  <th>Publisher</th>
                  <th>Key ID</th>
                  <th>Verified</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <code>{key.entityRef}</code>
                    </td>
                    <td>
                      <code>{key.keyId}</code>
                    </td>
                    <td>{new Date(key.ownershipVerifiedAt).toLocaleString()}</td>
                    <td>{key.revokedAt ? "Revoked" : "Active"}</td>
                    <td>
                      {!key.revokedAt ? (
                        <form action={revokeAction} className="adminMutationForm">
                          <input type="hidden" name="keyId" value={key.id} />
                          <input type="hidden" name="reason" value="administrative revocation" />
                          <button className="button buttonDanger" type="submit">
                            Revoke
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="meta">No signing keys have been enrolled for this workspace.</p>
        )}
        <Status state={revokeState} />
      </section>

      <section className="adminAuthPanel">
        <p className="eyebrow">1. Prove key possession</p>
        <h2>Create a signing challenge</h2>
        <form action={challengeAction} className="adminMutationForm">
          <label>
            Publisher entity reference
            <input name="entityRef" placeholder="entity:publisher-id" required />
          </label>
          <label>
            Key ID
            <input name="keyId" required />
          </label>
          <label>
            Ed25519 public key
            <input name="publicKey" required />
          </label>
          <button className="button" type="submit">
            Create challenge
          </button>
        </form>
        <Status state={challengeState} />
        {challengeState?.ok && challengeState.challenge ? (
          <pre className="serviceKeyCodeSample">
            {JSON.stringify(
              {
                schema: "spctre.publication-signing-challenge.v1",
                challengeId: challengeState.challengeId,
                challenge: challengeState.challenge,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </section>

      <section className="adminAuthPanel">
        <p className="eyebrow">2. Enroll or rotate</p>
        <h2>Submit the signed challenge receipt</h2>
        <form action={enrollAction} className="adminMutationForm">
          <label>
            Publisher entity reference
            <input name="entityRef" placeholder="entity:publisher-id" required />
          </label>
          <label>
            Key ID
            <input name="keyId" required />
          </label>
          <label>
            Ed25519 public key
            <input name="publicKey" required />
          </label>
          <label>
            Challenge ID
            <input name="challengeId" required />
          </label>
          <label>
            Replace key ID (optional)
            <input name="replacesKeyId" />
          </label>
          <label>
            Signed receipt JSON
            <textarea name="proof" rows={8} required />
          </label>
          <button className="button" type="submit">
            Enroll signing key
          </button>
        </form>
        <Status state={enrollState} />
      </section>
    </div>
  );
}
