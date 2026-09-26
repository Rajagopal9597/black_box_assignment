import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { activityEvents, users } from "../../db/schema.js";
import type { DbOrTx } from "../../db/types.js";
import { requireRole } from "../workspaces/access.js";

export type ActivityAction =
  | "workspace.created"
  | "workspace.renamed"
  | "document.uploaded"
  | "document.deleted"
  | "share.created"
  | "share.revoked"
  | "share.downloaded"
  | "member.invited"
  | "member.invite_revoked"
  | "member.joined"
  | "member.removed"
  | "member.left"
  | "member.role_changed";

export async function recordActivity(
  db: DbOrTx,
  event: { workspaceId: string; actorId: string | null; action: ActivityAction; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(activityEvents).values({ ...event, details: event.details ?? {} });
}

export async function listActivity(db: Db, workspaceId: string, userId: string, limit = 100) {
  await requireRole(db, workspaceId, userId, "viewer");
  return db
    .select({
      id: activityEvents.id,
      action: activityEvents.action,
      details: activityEvents.details,
      createdAt: activityEvents.createdAt,
      actorName: users.name,
    })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(eq(activityEvents.workspaceId, workspaceId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);
}
