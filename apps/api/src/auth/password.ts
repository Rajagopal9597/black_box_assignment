import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to Argon2id with OWASP-recommended parameters.
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  return verify(passwordHash, plain);
}
