import type { RequestHandler } from "express";
import { resolveSession, SESSION_COOKIE } from "../auth/session.js";
import type { Db } from "../db/client.js";
import { unauthorized } from "../lib/errors.js";

/** Runs on every /api request: attaches req.user if the session cookie is valid. Never rejects. */
export function authenticate(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0) {
      req.user = (await resolveSession(db, token)) ?? undefined;
    }
    next();
  };
}

/** Route guard: 401 unless signed in. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};
