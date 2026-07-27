import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function normalizeBase32(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

function decodeBase32(base32: string): Uint8Array {
  const normalized = normalizeBase32(base32);
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(out);
}

export function generateTotpSecret(length = 20): string {
  return encodeBase32(randomBytes(length));
}

function generateTotpCode(secretBase32: string, time = Date.now(), stepSeconds = 30): string {
  const secret = decodeBase32(secretBase32);
  const counter = Math.floor(time / 1000 / stepSeconds);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", Buffer.from(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, "0");
}

export function verifyTotpCode(params: {
  code: string;
  secretBase32: string;
  stepSeconds?: number;
  windowSteps?: number;
}): boolean {
  const code = params.code.trim();
  if (!/^\d{6}$/.test(code)) return false;

  const stepSeconds = params.stepSeconds ?? 30;
  const windowSteps = params.windowSteps ?? 1;
  const now = Date.now();
  const codeBytes = Buffer.from(code, "utf8");

  let matched = false;
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    const candidate = generateTotpCode(
      params.secretBase32,
      now + delta * stepSeconds * 1000,
      stepSeconds
    );
    // Constant-time compare; both values are exactly six ASCII digits.
    const candidateBytes = Buffer.from(candidate, "utf8");
    if (candidateBytes.length === codeBytes.length && timingSafeEqual(candidateBytes, codeBytes)) {
      matched = true;
    }
  }

  return matched;
}
