import { createHash } from "crypto";

export function computeShortHash(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
}
