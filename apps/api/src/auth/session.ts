import { and, eq, gt, lt } from "drizzle-orm";
import type { CookieOptions, Response } from "express";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { generateToken, hashToken } from "../lib/tokens.js";

/**
 * Server-side sessions.
 *  - The browser holds a random 256-bit token in an HttpOnly cookie.
 *  - The DB holds only SHA-256(token), so a DB leak can't be replayed as live sessions.
 *  - Logout deletes the row, so sessions are revocable immediately (unlike a stateless JWT).
 */
export const SESSION_COOKIE = "sid";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export async function createSession(db: Db, userId: string, ttlHours: number) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  // Opportunistic cleanup of this user's expired sessions.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

function cookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true, // not readable from JS -> XSS can't steal it
    sameSite: "lax", // not sent on cross-site POST/DELETE -> CSRF protection for state-changing calls
    secure,
    path: "/api", // only sent to the API
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(secure), expires: expiresAt });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
}
