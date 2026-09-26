import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/types.js";
import { workspaceMembers, workspaces, type WorkspaceRole } from "../../db/schema.js";
import { forbidden, notFound } from "../../lib/errors.js";

/**
 * THE authorization rule for everything inside a workspace. Every service goes through here.
 *
 *   viewer  < editor < owner
 *   viewer: see members, list + download documents, see activity
 *   editor: + upload, delete documents THEY uploaded, create/revoke share links
 *   owner:  + delete ANY document, invite/remove members, change roles, rename/delete workspace
 */
const RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

export async function getRole(db: DbOrTx, workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/**
 * Status codes:
 *  - workspace doesn't exist            -> 404
 *  - exists, caller is not a member     -> 403 "not a member"
 *  - member, but role is too low        -> 403 "requires <role>"
 *
 * 403 for outsiders is deliberate (see docs/DECISIONS.md §3): IDs are random UUIDv4s, so confirming
 * that one exists gives an attacker nothing to enumerate, and a precise 403 is clearer for users
 * following a stale link and for debugging.
 */
export async function requireRole(
  db: DbOrTx,
  workspaceId: string,
  userId: string,
  minimum: WorkspaceRole,
): Promise<WorkspaceRole> {
  const role = await getRole(db, workspaceId, userId);
  if (!role) {
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw notFound();
    throw forbidden("You are not a member of this workspace");
  }
  if (RANK[role] < RANK[minimum]) throw forbidden(`Requires ${minimum} role`);
  return role;
}

export function permissionsFor(role: WorkspaceRole) {
  return {
    canUpload: RANK[role] >= RANK.editor,
    canDeleteOwnDocuments: RANK[role] >= RANK.editor,
    canDeleteAnyDocument: role === "owner",
    canShare: RANK[role] >= RANK.editor,
    canManageMembers: role === "owner",
    canManageWorkspace: role === "owner",
  };
}
