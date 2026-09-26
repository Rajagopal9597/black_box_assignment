import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { documents, shareLinks, users } from "../../db/schema.js";
import { notFound } from "../../lib/errors.js";
import { generateToken, hashToken } from "../../lib/tokens.js";
import { recordActivity } from "../activity/activity.service.js";
import { activeShareFilter, getAuthorizedDocument } from "../documents/documents.service.js";
import { requireRole } from "../workspaces/access.js";


/**
 * Share links = read-only, anonymous access to ONE document.
 *  - A link lets anyone who has it see the file name/size and download it. Nothing else.
 *  - 256-bit random token; only its hash is stored -> not guessable, and the full URL is shown once.
 *  - Optional expiry (default 7 days), revocable, dies with the document. Download count is tracked.
 *  - Editors and owners can create/revoke; viewers can't re-share.
 */
export const CreateShareInput = z.object({
  // null = never expires
  expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.null()]).default(7),
});

export async function createShareLink(
  db: Db,
  documentId: string,
  userId: string,
  input: z.infer<typeof CreateShareInput>,
) {
  const doc = await getAuthorizedDocument(db, documentId, userId, "editor");
  const token = generateToken();
  const expiresAt = input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * 86_400_000);
  const share = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(shareLinks)
      .values({ documentId: doc.id, tokenHash: hashToken(token), createdBy: userId, expiresAt })
      .returning({ id: shareLinks.id, expiresAt: shareLinks.expiresAt, createdAt: shareLinks.createdAt });
    await recordActivity(tx, {
      workspaceId: doc.workspaceId,
      actorId: userId,
      action: "share.created",
      details: { document: doc.name, expiresAt },
    });
    return s!;
  });
  return { share, token };
}

export async function listShareLinks(db: Db, documentId: string, userId: string) {
  await getAuthorizedDocument(db, documentId, userId, "editor");
  const rows = await db
    .select({
      id: shareLinks.id,
      createdAt: shareLinks.createdAt,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      downloadCount: shareLinks.downloadCount,
      lastAccessedAt: shareLinks.lastAccessedAt,
      createdByName: users.name,
    })
    .from(shareLinks)
    .leftJoin(users, eq(users.id, shareLinks.createdBy))
    .where(eq(shareLinks.documentId, documentId))
    .orderBy(desc(shareLinks.createdAt));
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    status: r.revokedAt ? "revoked" : r.expiresAt && r.expiresAt.getTime() <= now ? "expired" : "active",
  }));
}

export async function revokeShareLink(db: Db, shareId: string, userId: string) {
  const [row] = await db
    .select({ id: shareLinks.id, revokedAt: shareLinks.revokedAt, workspaceId: documents.workspaceId, name: documents.name })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  if (!row) throw notFound();
  await requireRole(db, row.workspaceId, userId, "editor");
  if (row.revokedAt) return;
  await db.transaction(async (tx) => {
    await tx.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, shareId));
    await recordActivity(tx, {
      workspaceId: row.workspaceId,
      actorId: userId,
      action: "share.revoked",
      details: { document: row.name },
    });
  });
}

/** Public: resolve a token. Unknown, revoked, expired and deleted-document all give the same 404. */
async function resolveToken(db: Db, token: string) {
  const [row] = await db
    .select({ share: shareLinks, doc: documents })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .where(and(eq(shareLinks.tokenHash, hashToken(token)), activeShareFilter()))
    .limit(1);
  if (!row) throw notFound("This link is invalid or has expired");
  return row;
}

export async function getSharedDocumentInfo(db: Db, token: string) {
  const { share, doc } = await resolveToken(db, token);
  return { name: doc.name, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, expiresAt: share.expiresAt };
}

export async function recordSharedDownload(db: Db, token: string) {
  const { share, doc } = await resolveToken(db, token);
  await db.transaction(async (tx) => {
    await tx
      .update(shareLinks)
      .set({ downloadCount: sql`${shareLinks.downloadCount} + 1`, lastAccessedAt: new Date() })
      .where(eq(shareLinks.id, share.id));
    await recordActivity(tx, {
      workspaceId: doc.workspaceId,
      actorId: null,
      action: "share.downloaded",
      details: { document: doc.name },
    });
  });
  return doc;
}
