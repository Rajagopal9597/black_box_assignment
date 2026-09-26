import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import type { ObjectStorage } from "../storage/index.js";

/**
 * Stream a stored blob to the client. The browser never talks to object storage directly:
 * every byte goes through an authorization check first, and bucket URLs are never exposed.
 *
 * Always served as an attachment: an uploaded .html/.svg is downloaded, never rendered on our
 * origin (which would be stored XSS). helmet adds X-Content-Type-Options: nosniff.
 */
export async function sendDocument(
  res: Response,
  storage: ObjectStorage,
  doc: { storageKey: string; name: string; mimeType: string; sizeBytes: number },
): Promise<void> {
  const obj = await storage.get(doc.storageKey);
  res.setHeader("Content-Disposition", contentDisposition(doc.name));
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader("Content-Length", String(obj.contentLength ?? doc.sizeBytes));
  res.setHeader("Cache-Control", "private, no-store");
  await pipeline(obj.body, res);
}

/** Keep the original name for display, but strip anything that looks like a path or control char. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return cleaned || "untitled";
}

/**
 * RFC 6266 / 5987: an ASCII-only `filename` fallback plus a percent-encoded UTF-8 `filename*`.
 * (Express's res.attachment() emits raw Latin-1 bytes for names like "Résumé", which some clients garble.)
 */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
