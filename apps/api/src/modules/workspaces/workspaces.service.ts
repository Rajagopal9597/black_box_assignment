import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { documents, users, workspaceMembers, workspaces, type WorkspaceRole } from "../../db/schema.js";
import type { Tx } from "../../db/types.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import type { ObjectStorage } from "../../storage/index.js";
import { recordActivity } from "../activity/activity.service.js";
import { permissionsFor, requireRole } from "./access.js";

export const WorkspaceNameInput = z.object({ name: z.string().trim().min(1).max(100) });
export const RoleInput = z.object({ role: z.enum(["owner", "editor", "viewer"]) });

export async function listWorkspaces(db: Db, userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
      memberCount: sql<number>`(select count(*)::int from workspace_members m where m.workspace_id = ${workspaces.id})`,
      documentCount: sql<number>`(select count(*)::int from documents d where d.workspace_id = ${workspaces.id})`,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

export async function createWorkspace(db: Db, userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ name, createdBy: userId }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId, role: "owner" });
    await recordActivity(tx, { workspaceId: ws!.id, actorId: userId, action: "workspace.created", details: { name } });
    return { ...ws!, role: "owner" as const, permissions: permissionsFor("owner") };
  });
}

export async function getWorkspace(db: Db, workspaceId: string, userId: string) {
  const role = await requireRole(db, workspaceId, userId, "viewer");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw notFound();
  // The UI renders buttons from `permissions`, but the server re-checks on every action.
  return { id: ws.id, name: ws.name, createdAt: ws.createdAt, role, permissions: permissionsFor(role) };
}

export async function renameWorkspace(db: Db, workspaceId: string, userId: string, name: string) {
  await requireRole(db, workspaceId, userId, "owner");
  await db.transaction(async (tx) => {
    await tx.update(workspaces).set({ name }).where(eq(workspaces.id, workspaceId));
    await recordActivity(tx, { workspaceId, actorId: userId, action: "workspace.renamed", details: { name } });
  });
}

/**
 * Deleting a workspace deletes everything in it. DB rows go first (one transaction, via cascades);
 * blobs are removed afterwards. If a blob delete fails we log it — an orphaned blob is invisible
 * and harmless, whereas deleting blobs first could leave rows pointing at missing files.
 */
export async function deleteWorkspace(db: Db, storage: ObjectStorage, workspaceId: string, userId: string) {
  await requireRole(db, workspaceId, userId, "owner");
  const keys = await db.transaction(async (tx) => {
    const docs = await tx
      .select({ key: documents.storageKey })
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId));
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
    return docs.map((d) => d.key);
  });
  await Promise.all(
    keys.map((key) =>
      storage.delete(key).catch((err) => logger.error({ err, key }, "orphaned blob: failed to delete")),
    ),
  );
}

export async function listMembers(db: Db, workspaceId: string, userId: string) {
  await requireRole(db, workspaceId, userId, "viewer");
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

/**
 * A workspace must always keep at least one owner. Owner rows are locked (FOR UPDATE) so two
 * concurrent demotions can't both pass the check and leave the workspace ownerless.
 */
async function assertAnotherOwnerExists(tx: Tx, workspaceId: string, exceptUserId: string) {
  const others = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
        ne(workspaceMembers.userId, exceptUserId),
      ),
    )
    .for("update");
  if (others.length === 0) {
    throw badRequest("A workspace must have at least one owner. Promote someone else first, or delete the workspace.");
  }
}

async function getMemberForUpdate(tx: Tx, workspaceId: string, userId: string) {
  const [m] = await tx
    .select({ role: workspaceMembers.role, name: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .for("update", { of: workspaceMembers });
  if (!m) throw notFound("Member not found");
  return m;
}

export async function changeMemberRole(
  db: Db,
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  role: WorkspaceRole,
) {
  await requireRole(db, workspaceId, actorId, "owner");
  await db.transaction(async (tx) => {
    const target = await getMemberForUpdate(tx, workspaceId, targetUserId);
    if (target.role === role) return;
    if (target.role === "owner") await assertAnotherOwnerExists(tx, workspaceId, targetUserId);
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
    await recordActivity(tx, {
      workspaceId,
      actorId,
      action: "member.role_changed",
      details: { member: target.name, from: target.role, to: role },
    });
  });
}

/** Owners can remove anyone; any member can remove themselves (leave). Their uploads stay in the workspace. */
export async function removeMember(db: Db, workspaceId: string, actorId: string, targetUserId: string) {
  const leaving = actorId === targetUserId;
  await requireRole(db, workspaceId, actorId, leaving ? "viewer" : "owner");
  await db.transaction(async (tx) => {
    const target = await getMemberForUpdate(tx, workspaceId, targetUserId);
    if (target.role === "owner") await assertAnotherOwnerExists(tx, workspaceId, targetUserId);
    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
    await recordActivity(tx, {
      workspaceId,
      actorId,
      action: leaving ? "member.left" : "member.removed",
      details: { member: target.name },
    });
  });
}
