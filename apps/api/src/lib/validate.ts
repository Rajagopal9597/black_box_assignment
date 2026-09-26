import type { Request } from "express";
import { z } from "zod";
import { notFound } from "./errors.js";

const Uuid = z.uuid();

/**
 * Read a UUID route param. A malformed id is treated as "not found" (404) rather than letting
 * Postgres raise a cast error (500) or leaking that the id format was wrong.
 */
export function uuidParam(req: Request, name: string): string {
  const parsed = Uuid.safeParse(req.params[name]);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

/** Token params (share / invite links): base64url, fixed length. */
export function tokenParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw notFound();
  return value;
}
