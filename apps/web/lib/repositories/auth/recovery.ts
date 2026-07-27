import { randomBytes, scrypt, timingSafeEqual, createHmac, type ScryptOptions } from "crypto";
import { rawSql } from "@/lib/db";

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };

// Async scrypt runs the (deliberately expensive, N=16384) key derivation on the
// libuv threadpool instead of the event loop — a synchronous derivation blocks
// the whole web instance for tens of ms, and this path is reachable
// pre-authentication. See concurrency-and-memory-audit finding 3.
function scryptAsync(password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const CODE_COUNT = 8;
const CODE_BYTES = 5; // 10 hex chars per code

// Domain-separated sub-key derived from the session-guard secret so we never
// HMAC recovery codes with the raw secret. Recomputed per call (cheap) rather
// than cached, so a rotated secret takes effect immediately.
function recoveryLookupKey(): Buffer {
  const secret = process.env.SPCTRE_SESSION_GUARD_SECRET;
  if (!secret) {
    throw new Error("SPCTRE_SESSION_GUARD_SECRET is required for recovery-code lookup.");
  }
  return createHmac("sha256", secret).update("recovery-code-lookup-v1").digest();
}

// Deterministic keyed lookup of a code so consume() can fetch the single
// candidate row and scrypt-verify exactly once instead of scanning all rows.
function computeCodeLookup(code: string): string {
  return createHmac("sha256", recoveryLookupKey()).update(code.toUpperCase()).digest("hex");
}

async function hashRecoveryCode(code: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(code.toUpperCase(), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyRecoveryCode(code: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  if (!salt || !hash) return false;
  try {
    const derivedKey = await scryptAsync(code.toUpperCase(), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
    const inputHash = Buffer.from(derivedKey.toString("hex"), "hex");
    const storedHashBuf = Buffer.from(hash, "hex");
    if (inputHash.length !== storedHashBuf.length) return false;
    return timingSafeEqual(inputHash, storedHashBuf);
  } catch {
    return false;
  }
}

export async function generateRecoveryCodes(params: {
  principalId: string;
  tenantId: string;
}): Promise<string[]> {
  if (!rawSql) throw new Error("Database not configured.");

  await rawSql`
    DELETE FROM recovery_code
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND used_at IS NULL
  `;

  const codes: string[] = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    codes.push(randomBytes(CODE_BYTES).toString("hex").toUpperCase());
  }

  // Derive all hashes concurrently on the threadpool, then insert.
  const prepared = await Promise.all(
    codes.map(async (code) => ({
      hash: await hashRecoveryCode(code),
      lookup: computeCodeLookup(code),
    }))
  );

  for (const { hash, lookup } of prepared) {
    await rawSql`
      INSERT INTO recovery_code (principal_id, tenant_id, code_hash, code_lookup)
      VALUES (${params.principalId}, ${params.tenantId}, ${hash}, ${lookup})
    `;
  }

  return codes;
}

export async function consumeRecoveryCode(params: {
  principalId: string;
  tenantId: string;
  code: string;
}): Promise<boolean> {
  if (!rawSql) return false;

  const code = params.code.trim();
  const lookup = computeCodeLookup(code);

  // Primary path: fetch the single candidate row by deterministic lookup, then
  // scrypt-verify exactly once.
  const candidateRows = await rawSql<{ id: string; code_hash: string }[]>`
    SELECT id, code_hash
    FROM recovery_code
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND used_at IS NULL
      AND code_lookup = ${lookup}
    LIMIT 1
  `;

  let matchingId: string | undefined;
  if (candidateRows[0] && (await verifyRecoveryCode(code, candidateRows[0].code_hash))) {
    matchingId = candidateRows[0].id;
  } else {
    // Legacy fallback: pre-migration rows have code_lookup NULL and can't be
    // located by lookup. Scan only those — a bounded set that empties as codes
    // rotate — so the old O(n) scrypt scan can't be re-triggered at scale.
    const legacyRows = await rawSql<{ id: string; code_hash: string }[]>`
      SELECT id, code_hash
      FROM recovery_code
      WHERE principal_id = ${params.principalId}
        AND tenant_id = ${params.tenantId}
        AND used_at IS NULL
        AND code_lookup IS NULL
    `;
    for (const r of legacyRows) {
      if (await verifyRecoveryCode(code, r.code_hash)) {
        matchingId = r.id;
        break;
      }
    }
  }

  if (!matchingId) return false;

  const updateRows = await rawSql<{ id: string }[]>`
    UPDATE recovery_code
    SET used_at = now()
    WHERE id = ${matchingId}
      AND principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND used_at IS NULL
    RETURNING id
  `;

  return updateRows.length > 0;
}

export async function countUnusedRecoveryCodes(params: {
  principalId: string;
  tenantId: string;
}): Promise<number> {
  if (!rawSql) return 0;
  const rows = await rawSql<{ n: string }[]>`
    SELECT count(*) AS n
    FROM recovery_code
    WHERE principal_id = ${params.principalId}
      AND tenant_id = ${params.tenantId}
      AND used_at IS NULL
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function findPrincipalByEmail(email: string): Promise<{
  principalId: string;
  tenantId: string;
  subject: string;
} | null> {
  if (!rawSql || !email.trim()) return null;

  const rows = await rawSql<{ id: string; tenant_id: string; subject: string }[]>`
    SELECT id, tenant_id, subject
    FROM app_principal
    WHERE lower(email) = lower(${email.trim()})
      AND principal_type = 'USER'
      AND disabled_at IS NULL
      AND invite_status <> 'REVOKED'
    ORDER BY created_at ASC
    LIMIT 1
  `;

  if (!rows[0]) return null;
  return { principalId: rows[0].id, tenantId: rows[0].tenant_id, subject: rows[0].subject };
}
