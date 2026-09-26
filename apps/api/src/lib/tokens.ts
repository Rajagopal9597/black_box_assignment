import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque secrets for sessions, share links and invitations.
 * 32 random bytes = 256 bits of entropy: not guessable, not enumerable.
 * Only the SHA-256 hash is persisted, so a DB leak doesn't leak working links.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
