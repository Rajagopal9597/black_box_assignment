import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, or, gt, sql } from "drizzle-orm";
import type { AuthUser } from "../../auth/session.js";
import type { Db } from "../../db/client.js";
import { documents, shareLinks, users } from "../../db/schema.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { sanitizeFilename } from "../../lib/download.js";
import { logger } from "../../lib/logger.js";
import type { ObjectStorage } from "../../storage/index.js";
import { recordActivity } from "../activity/activity.service.js";
import { requireRole } from "../workspaces/access.js";

export async function listDocuments(db: Db, workspaceId: string, userId: string) {
  await requireRole(db, workspaceId, userId, "viewer");
  const now = new Date();
  return db
    .select({
      id: documents.id,
      name: documents.name,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      createdAt: documents.createdAt,
      uploadedById: documents.uploadedBy,
      uploadedByName: users.name,
      activeShareCount: sql<number>`(
        select count(*)::int from ${shareLinks}
        where ${shareLinks.documentId} = ${documents.id}
          and ${shareLinks.revokedAt} is null
          and (${shareLinks.expiresAt} is null or ${shareLinks.expiresAt} > ${now})
      )`,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(eq(documents.workspaceId, workspaceId))
    .orderBy(desc(documents.createdAt));
}

/**
 * Upload order: blob first, then the DB row. If the insert fails we delete the blob, so there's
 * never a row pointing to a missing file. Storage keys are server-generated UUIDs — the user's
 * filename is never part of a path.
 */
export async function uploadDocument(
  db: Db,
  storage: ObjectStorage,
  workspaceId: string,
  user: AuthUser,
  file: Express.Multer.File | undefined,
) {
  await requireRole(db, workspaceId, user.id, "editor");
  if (!file) throw badRequest("No file uploaded (expected multipart field 'file')");
  if (file.size === 0) throw badRequest("File is empty");

  const name = sanitizeFilename(file.originalname);
  const mimeType = file.mimetype || "application/octet-stream";
  const storageKey = `workspaces/${workspaceId}/${randomUUID()}`;

  await storage.put({ key: storageKey, body: file.buffer, contentType: mimeType });
  try {
    return await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId, uploadedBy: user.id, name, mimeType, sizeBytes: file.size, storageKey })
        .returning({
          id: documents.id,
          name: documents.name,
          mimeType: documents.mimeType,
          sizeBytes: documents.sizeBytes,
          createdAt: documents.createdAt,
        });
      await recordActivity(tx, {
        workspaceId,
        actorId: user.id,
        action: "document.uploaded",
        details: { document: name, sizeBytes: file.size },
      });
      return doc!;
    });
  } catch (err) {
    await storage.delete(storageKey).catch(() => {});
    throw err;
  }
}

/**
 * Load a document and check the caller's role in ITS workspace. Callers pass only a document id,
 * so this is the guard against "user A guesses user B's document id".
 */
export async function getAuthorizedDocument(db: Db, documentId: string, userId: string, minimum: "viewer" | "editor") {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw notFound();
  const role = await requireRole(db, doc.workspaceId, userId, minimum); // non-member -> 403
  return { ...doc, callerRole: role };
}

/**
 * Hard delete: row (and its share links, via cascade) first, then the blob.
 * Editors may delete only what they uploaded; owners may delete anything (e.g. files left behind
 * by someone who has left the team).
 */
export async function deleteDocument(db: Db, storage: ObjectStorage, documentId: string, userId: string) {
  const doc = await getAuthorizedDocument(db, documentId, userId, "editor");
  if (doc.callerRole !== "owner" && doc.uploadedBy !== userId) {
    throw forbidden("Editors can only delete documents they uploaded");
  }
  await db.transaction(async (tx) => {
    await tx.delete(documents).where(eq(documents.id, doc.id));
    await recordActivity(tx, {
      workspaceId: doc.workspaceId,
      actorId: userId,
      action: "document.deleted",
      details: { document: doc.name },
    });
  });
  await storage
    .delete(doc.storageKey)
    .catch((err) => logger.error({ err, key: doc.storageKey }, "orphaned blob: failed to delete"));
}

// Re-exported for the shares module.
export const activeShareFilter = () =>
  and(isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, new Date())));
