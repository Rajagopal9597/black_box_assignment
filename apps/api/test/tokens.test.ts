import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/lib/tokens.js";

describe("tokens", () => {
  it("generates unique, URL-safe tokens with 256 bits of entropy", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically and never returns the raw token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toHaveLength(64);
  });
});
